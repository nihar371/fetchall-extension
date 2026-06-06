importScripts('lib/jszip.min.js');

let collectedFiles = [];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startSearchLoop") {
    collectedFiles = [];
    chrome.storage.local.set({
      isScanning: true,
      processedCount: 0
    }, () => {
      sendResponse({ status: "initialized" });
    });
    return true;
  }

  if (request.action === "postLog") {
    chrome.runtime.sendMessage({ action: "updateStatus", text: request.text });
    return;
  }

  if (request.action === "collectAttachment" && request.file) {
    collectedFiles.push(request.file);
    return;
  }

  if (request.action === "finalizeZipBundle") {
    chrome.storage.local.set({ isScanning: false });
    chrome.runtime.sendMessage({ action: "updateStatus", text: `Compiling ZIP packaging for ${collectedFiles.length} items...` });
    buildAndDownloadZip(collectedFiles);
  }
});

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 180);
}

async function buildAndDownloadZip(fileList) {
  if (!fileList || fileList.length === 0) {
    chrome.runtime.sendMessage({ action: "updateStatus", text: "Finished. No files found." });
    return;
  }

  const zip = new JSZip();

  for (const file of fileList) {
    const base64Content = file.dataUrl ? file.dataUrl.split(',')[1] : '';
    const safeName = sanitizeFileName(file.name || `attachment_${Date.now()}`);
    if (base64Content) {
      zip.file(safeName, base64Content, { base64: true });
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const blobUrl = URL.createObjectURL(blob);

  chrome.downloads.download({
    url: blobUrl,
    filename: "gmail-attachments.zip",
    saveAs: true
  }, () => {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    chrome.runtime.sendMessage({ action: "updateStatus", text: "Download triggered successfully!" });
  });
}
