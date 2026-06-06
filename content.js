const delay = ms => new Promise(res => setTimeout(res, ms));
let isProcessing = false;
let collectedUrls = new Set();

const backButtonSelectors = [
  'button[aria-label^="Back"]',
  'button[aria-label*="Back"]',
  'a[aria-label^="Back"]',
  'div[aria-label*="Back to Inbox"]',
  'div[data-tooltip*="Back"]',
  'div[role="button"][aria-label*="Back"]',
  'div[role="button"][data-tooltip*="Back"]'
].join(',');

function findBackButton() {
  return document.querySelector(backButtonSelectors);
}

function isMessageView() {
  return !!findBackButton();
}

function isListView() {
  return document.querySelectorAll('tr.zA').length > 0;
}

async function waitFor(predicate, timeout = 15000, interval = 250) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (typeof predicate === 'function' && predicate()) {
        return true;
      }
    } catch (e) {}
    await delay(interval);
  }
  return false;
}

async function processGmailAutomation() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const state = await chrome.storage.local.get(["isScanning", "processedCount"]);
    if (!state.isScanning) {
      chrome.runtime.sendMessage({ action: "postLog", text: "Scan is not active." }).catch(() => {});
      return;
    }

    const currentCount = state.processedCount || 0;

    if (isMessageView()) {
      await delay(2000);
      const links = Array.from(document.querySelectorAll('a[href*="disp=attd"], a[href*="mail/u/0/?ui=2"], a[href*="attachment"]'));
      
      if (links.length === 0) {
        chrome.runtime.sendMessage({ action: "postLog", text: "No attachments found, returning..." }).catch(() => {});
      }

      for (const link of links) {
        const url = link.href;
        const name = link.getAttribute('download') || link.textContent.trim() || `attachment_${Date.now()}`;

        if (url && !collectedUrls.has(url)) {
          try {
            chrome.runtime.sendMessage({ action: "postLog", text: `Fetching: ${name.substring(0, 20)}...` }).catch(() => {});
            
            // FIX: Removed { credentials: 'same-origin' } to avoid CORS issues on Google Content subdomains
            const response = await fetch(url); 
            const blob = await response.blob();
            const base64Data = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });

            collectedUrls.add(url);
            chrome.runtime.sendMessage({ action: "collectAttachment", file: { name, dataUrl: base64Data, url } }).catch(() => {});
          } catch (e) {
            console.error('Failed to extract file attachment stream', e);
          }
        }
      }

      await chrome.storage.local.set({ processedCount: currentCount + 1 });
      chrome.runtime.sendMessage({ action: "postLog", text: "Moving back to listings..." }).catch(() => {});

      const backButton = findBackButton();
      if (backButton) {
        backButton.click();
      } else {
        history.back();
      }

      const switched = await waitFor(isListView, 10000);
      if (!switched) {
        chrome.runtime.sendMessage({ action: "postLog", text: "Could not detect list, retrying..." }).catch(() => {});
        await delay(2000);
      }
      
      isProcessing = false;
      processGmailAutomation();
      return;
    }

    const emailRows = Array.from(document.querySelectorAll('tr.zA'));
    if (emailRows.length === 0) {
      chrome.runtime.sendMessage({ action: "postLog", text: "Waiting for Gmail messages to load..." }).catch(() => {});
      await delay(2000);
      isProcessing = false;
      processGmailAutomation();
      return;
    }

    if (currentCount >= emailRows.length) {
      chrome.runtime.sendMessage({ action: "finalizeZipBundle" }).catch(() => {});
      return;
    }

    chrome.runtime.sendMessage({ action: "postLog", text: `Opening email ${currentCount + 1} of ${emailRows.length}...` }).catch(() => {});
    const row = emailRows[currentCount];
    const clickable = row.querySelector('div[role="link"], a[href]') || row;
    clickable.click();

    await waitFor(isMessageView, 10000);
    isProcessing = false;
    processGmailAutomation();
  } catch (error) {
    console.error("Automation error:", error);
    isProcessing = false;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "triggerScanStart") {
    collectedUrls.clear();
    chrome.storage.local.set({ isScanning: true, processedCount: 0 }, () => {
      chrome.runtime.sendMessage({ action: "postLog", text: "Gmail automation starting..." }).catch(() => {});
      processGmailAutomation();
    });
    sendResponse({ status: "triggered" });
    return true;
  }
});
// FIX: Removed the MutationObserver entirely to prevent immediate crashing and infinite loop races.