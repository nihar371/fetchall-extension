const delay = ms => new Promise(res => setTimeout(res, ms));
let isProcessing = false;
let collectedUrls = new Set();
let collectedAttachments = []; // Stores the raw file blobs natively
let emailsProcessed = 0;

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isListView() {
  const rows = document.querySelectorAll('tr.zA');
  return Array.from(rows).some(isVisible);
}

function isEmailView() {
  // We explicitly check for the "Back" button. This guarantees we don't confuse the list view for an email.
  const backBtns = document.querySelectorAll('div[act="19"], div[aria-label^="Back to "], .ar6.T-I-J3.J-J5-Ji');
  return Array.from(backBtns).some(isVisible);
}

function getNextButton() {
  if (!isEmailView()) return null; // Prevents accidentally grabbing the list view pagination
  const btns = document.querySelectorAll('div[aria-label="Older"], div[data-tooltip="Older"]');
  return Array.from(btns).find(isVisible) || null;
}

function getCleanFilename(link) {
  // 1. Check if the 'download' attribute has a clean, real name
  let attrName = link.getAttribute('download');
  if (attrName && attrName !== 'true' && attrName !== 'attachment') {
    return attrName;
  }

  // 2. Check aria-labels or tooltips (Gmail usually formats these as "Download my_file.pdf")
  const aria = link.getAttribute('aria-label') || link.getAttribute('data-tooltip') || '';
  let cleanAria = aria.replace(/^(Download|Preview) attachment /i, '').replace(/^Download /i, '').trim();
  if (cleanAria && cleanAria.includes('.')) {
    return cleanAria;
  }

  // 3. Fallback: Use Regex to extract just the first valid filename from the mashed text
  const text = link.textContent || '';
  const match = text.match(/([a-zA-Z0-9_ \-\(\)]+\.[a-zA-Z0-9]{2,5})/);
  if (match) {
    return match[1].trim();
  }

  // 4. Absolute failsafe
  return `attachment_${Date.now()}`;
}

// Generate the ZIP directly in the browser tab
async function compileAndDownloadZip() {
  if (collectedAttachments.length === 0) {
    chrome.runtime.sendMessage({ action: "postLog", text: "Finished. No files found to zip." }).catch(() => {});
    chrome.storage.local.set({ isScanning: false });
    return;
  }

  chrome.runtime.sendMessage({ action: "postLog", text: `Compiling ZIP for ${collectedAttachments.length} items. Please wait...` }).catch(() => {});

  try {
    const zip = new JSZip();
    for (const file of collectedAttachments) {
      zip.file(file.name, file.blob);
    }

    // Generate as Base64 instead of a Blob to bypass Gmail's security policy
    const zipBase64 = await zip.generateAsync({ type: "base64" });
    const dataUrl = "data:application/zip;base64," + zipBase64;

    // Send the massive string to the background script to handle the actual saving
    chrome.runtime.sendMessage({ 
      action: "triggerNativeDownload", 
      url: dataUrl 
    }, (response) => {
      chrome.runtime.sendMessage({ action: "postLog", text: "Download triggered successfully!" }).catch(() => {});
    });

  } catch (error) {
    console.error("ZIP Generation failed:", error);
    chrome.runtime.sendMessage({ action: "postLog", text: "Error generating ZIP. Check console." }).catch(() => {});
  } finally {
    chrome.storage.local.set({ isScanning: false });
    isProcessing = false;
  }
}

async function processGmailAutomation() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const state = await chrome.storage.local.get(["isScanning"]);
    if (!state.isScanning) {
      isProcessing = false;
      return;
    }

    // STEP 1: Handle List View 
    if (isListView() && !isEmailView()) {
      chrome.runtime.sendMessage({ action: "postLog", text: "Starting from list. Opening first email..." }).catch(() => {});
      const firstRow = Array.from(document.querySelectorAll('tr.zA')).find(isVisible);
      
      if (firstRow) {
        const clickable = firstRow.querySelector('div[role="link"], a[href]') || firstRow;
        clickable.click();
        await delay(2500); 
        isProcessing = false;
        processGmailAutomation();
        return;
      }
    }

    // STEP 2: The Main Loop
    if (isEmailView()) {
      emailsProcessed++;
      chrome.runtime.sendMessage({ action: "postLog", text: `Scanning email #${emailsProcessed}...` }).catch(() => {});
      
      // Bumped this delay slightly in case attachments are lazy-loading
      await delay(2500); 

      // NEW: A highly aggressive list of known Gmail attachment URL patterns
      const attachmentSelectors = [
        'a[href*="view=att"]',
        'a[href*="disp=safe"]',
        'a[href*="disp=attd"]',
        'a[download]'
      ].join(',');

      const links = Array.from(document.querySelectorAll(attachmentSelectors));
      
      // Add a quick visual log to the console so we can see if it found anything
      console.log(`[FetchAll] Found ${links.length} potential attachment links in email #${emailsProcessed}`);

      for (const link of links) {
        const url = link.href;
        const name = getCleanFilename(link);
        
        if (url && !collectedUrls.has(url)) {
          try {
            chrome.runtime.sendMessage({ action: "postLog", text: `Fetching: ${name.substring(0, 20)}...` }).catch(() => {});
            
            const response = await fetch(url); 
            const blob = await response.blob();
            
            // Store the raw blob immediately. No Base64 overhead needed!
            collectedUrls.add(url);
            collectedAttachments.push({ name, blob }); 
          } catch (e) {
            console.error('Failed to extract file attachment stream', e);
          }
        }
      }

      // STEP 3: Navigate to NEXT email
      const nextBtn = getNextButton();
      if (nextBtn) {
        const isDisabled = nextBtn.getAttribute('aria-disabled') === 'true';
        
        if (isDisabled) {
          chrome.runtime.sendMessage({ action: "postLog", text: "End of search list reached!" }).catch(() => {});
          await compileAndDownloadZip();
          return;
        }

        chrome.runtime.sendMessage({ action: "postLog", text: "Moving to next email..." }).catch(() => {});
        nextBtn.click();
        
        await delay(1500); 
        isProcessing = false;
        processGmailAutomation();
        return;
      } else {
         chrome.runtime.sendMessage({ action: "postLog", text: "No pagination found. Ending scan." }).catch(() => {});
         await compileAndDownloadZip();
         return;
      }
    }

    await delay(1000);
    isProcessing = false;
    processGmailAutomation();

  } catch (error) {
    if (error.message.includes("Extension context invalidated")) {
      console.warn("[FetchAll] Extension updated. Please refresh the page.");
      isProcessing = false;
      return; 
    }
    console.error("Automation error:", error);
    isProcessing = false;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "triggerScanStart") {
    // Reset our tab-level state
    collectedUrls.clear();
    collectedAttachments = []; 
    emailsProcessed = 0; 
    
    chrome.storage.local.set({ isScanning: true }, () => {
      chrome.runtime.sendMessage({ action: "postLog", text: "Gmail automation starting..." }).catch(() => {});
      processGmailAutomation();
    });
    sendResponse({ status: "triggered" });
    return true;
  }
});