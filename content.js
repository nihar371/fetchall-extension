const delay = ms => new Promise(res => setTimeout(res, ms));
let isProcessing = false;
let collectedUrls = new Set();
let collectedAttachments = []; 
let fileNameTracker = new Map(); // NEW: Tracks duplicate filenames
let emailsProcessed = 0;

// NEW: Smart extractor with strict extension checking
function getCleanFilename(link) {
  let attrName = link.getAttribute('download');
  if (attrName && attrName !== 'true' && attrName !== 'attachment') {
    return attrName;
  }

  const aria = link.getAttribute('aria-label') || link.getAttribute('data-tooltip') || '';
  let cleanAria = aria.replace(/^(Download|Preview|Open) (attachment )?/i, '').trim();
  if (cleanAria && cleanAria.includes('.')) {
    return cleanAria;
  }

  const text = link.textContent || '';
  // STRICT REGEX: Only accepts real file extensions, stopping the "pdfPr" bug
  const match = text.match(/(.*?\.(?:pdf|png|jpe?g|gif|docx?|xlsx?|pptx?|csv|zip|rar|txt|mp\d|svg|avi|mov))/i);
  
  if (match) {
    let extracted = match[1].trim();
    // Strip out the leading "Preview attachment" text if it got glued to the front
    extracted = extracted.replace(/^(Preview|Download) attachment /i, '').trim();
    return extracted;
  }

  return `attachment_${Date.now()}.file`;
}

// NEW: Duplicate Filename Handler
function getUniqueFilename(baseName) {
  if (!fileNameTracker.has(baseName)) {
    fileNameTracker.set(baseName, 1);
    return baseName;
  }

  let count = fileNameTracker.get(baseName);
  let newName;
  let lastDotIndex = baseName.lastIndexOf('.');

  // If it has an extension, insert the number before it: "file (1).pdf"
  if (lastDotIndex !== -1) {
    let namePart = baseName.substring(0, lastDotIndex);
    let extPart = baseName.substring(lastDotIndex);
    newName = `${namePart} (${count})${extPart}`;
  } else {
    // If no extension, just append it: "file (1)"
    newName = `${baseName} (${count})`;
  }

  fileNameTracker.set(baseName, count + 1);
  return newName;
}

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
  const backBtns = document.querySelectorAll('div[act="19"], div[aria-label^="Back to "], .ar6.T-I-J3.J-J5-Ji');
  return Array.from(backBtns).some(isVisible);
}

function getNextButton() {
  if (!isEmailView()) return null; 
  const btns = document.querySelectorAll('div[aria-label="Older"], div[data-tooltip="Older"]');
  return Array.from(btns).find(isVisible) || null;
}

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

    const zipBase64 = await zip.generateAsync({ type: "base64" });
    const dataUrl = "data:application/zip;base64," + zipBase64;

    chrome.runtime.sendMessage({ 
      action: "triggerNativeDownload", 
      url: dataUrl 
    }, () => {
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

    if (isEmailView()) {
      emailsProcessed++;
      chrome.runtime.sendMessage({ action: "postLog", text: `Scanning email #${emailsProcessed}...` }).catch(() => {});
      await delay(2500); 

      const attachmentSelectors = [
        'a[href*="view=att"]',
        'a[href*="disp=safe"]',
        'a[href*="disp=attd"]',
        'a[download]'
      ].join(',');

      const links = Array.from(document.querySelectorAll(attachmentSelectors));
      
      for (const link of links) {
        const url = link.href;
        
        if (url && !collectedUrls.has(url)) {
          try {
            // Process the raw name and pass it through our deduplicator
            const rawName = getCleanFilename(link);
            const finalName = getUniqueFilename(rawName);

            chrome.runtime.sendMessage({ action: "postLog", text: `Fetching: ${finalName.substring(0, 20)}...` }).catch(() => {});
            
            const response = await fetch(url); 
            const blob = await response.blob();
            
            collectedUrls.add(url);
            // Save it to our array with the deduplicated name
            collectedAttachments.push({ name: finalName, blob }); 
          } catch (e) {
            console.error('Failed to extract file attachment stream', e);
          }
        }
      }

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
    collectedUrls.clear();
    collectedAttachments = []; 
    fileNameTracker.clear(); // Reset the duplicate tracker on a new scan
    emailsProcessed = 0; 
    
    chrome.storage.local.set({ isScanning: true }, () => {
      chrome.runtime.sendMessage({ action: "postLog", text: "Gmail automation starting..." }).catch(() => {});
      processGmailAutomation();
    });
    sendResponse({ status: "triggered" });
    return true;
  }
});