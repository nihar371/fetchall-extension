chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startSearchLoop") {
    chrome.storage.local.set({ isScanning: true }, () => {
      sendResponse({ status: "initialized" });
    });
    return true;
  }

  // Forward progress data and logs to popup UI
  if (request.action === "progressUpdate" || request.action === "postLog") {
    chrome.runtime.sendMessage(request).catch(() => {});
    return;
  }
});