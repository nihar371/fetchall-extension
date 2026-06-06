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
    chrome.runtime.sendMessage({ action: "updateStatus", text: request.text }).catch(() => {});
    return;
  }

  if (request.action === "collectAttachment" && request.file) {
    collectedFiles.push(request.file);
    return;
  }

  if (request.action === "finalizeZipBundle") {
    chrome.storage.local.set({ isScanning: false });
    chrome.runtime.sendMessage({ action: "updateStatus", text: `Compiling ZIP packaging for ${collectedFiles.length} items...` }).catch(() => {});
    buildAndDownloadZip(collectedFiles);
  }
});

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 180);
}

async function buildAndDownloadZip(fileList) {
  if (!fileList || fileList.length === 0) {
    chrome.runtime.sendMessage({ action: "updateStatus", text: "Finished. No files found." }).catch(() => {});
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

  // FIX: Use base64 Data URL instead of createObjectURL (which isn't supported in MV3 Service Workers)
  const base64Zip = await zip.generateAsync({ type: "base64" });
  const dataUrl = "data:application/zip;base64," + base64Zip;

  chrome.downloads.download({
    url: dataUrl,
    filename: "gmail-attachments.zip",
    saveAs: true
  }, () => {
    chrome.runtime.sendMessage({ action: "updateStatus", text: "Download triggered successfully!" }).catch(() => {});
  });
}