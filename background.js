chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startSearchLoop") {
    chrome.storage.local.set({ isScanning: true }, () => {
      sendResponse({ status: "initialized" });
    });
    return true;
  }

  if (request.action === "postLog") {
    chrome.runtime.sendMessage({ action: "updateStatus", text: request.text }).catch(() => {});
    return;
  }

  // NEW: Catch the compiled ZIP from the content script and force the browser to download it
  if (request.action === "triggerNativeDownload") {
    chrome.downloads.download({
      url: request.url,
      filename: `gmail-attachments-${Date.now()}.zip`,
      saveAs: true // Set to false if you want it to bypass the "Save As" popup
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("Download failed:", chrome.runtime.lastError);
      } else {
        console.log("Successfully downloaded with ID:", downloadId);
      }
      sendResponse({ status: "downloading" });
    });
    return true; // Keep message channel open for async response
  }
});