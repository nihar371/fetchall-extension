const delay = ms => new Promise(res => setTimeout(res, ms));
let isProcessing = false;
let collectedUrls = new Set();
let fileNameTracker = new Map();

// Scan state
let scanStats = {
  emailsScanned: 0,
  filesFound: 0,
  sizeBytes: 0
};
let currentSettings = {};

// --- IndexedDB Setup ---
const DB_NAME = "FetchAll_DB";
const STORE_NAME = "attachments";

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveAttachmentToDB(fileData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(fileData);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllAttachmentsFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function clearAttachmentsDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
// ---------------------------------------------

function reportProgress(textMsg, isFinished = false) {
  chrome.runtime.sendMessage({
    action: "progressUpdate",
    text: textMsg,
    stats: {
      emailsScanned: scanStats.emailsScanned,
      filesFound: scanStats.filesFound,
      sizeMb: (scanStats.sizeBytes / (1024 * 1024)).toFixed(2)
    },
    finished: isFinished
  }).catch(() => {});
}

async function waitForElement(selector, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const elements = Array.from(document.querySelectorAll(selector));
    const visibleEl = elements.find(isVisible);
    if (visibleEl) return visibleEl;
    await delay(250);
  }
  return null;
}

function getCleanFilename(link) {
  let attrName = link.getAttribute('download');
  if (attrName && attrName !== 'true' && attrName !== 'attachment') return attrName;
  
  const aria = link.getAttribute('aria-label') || link.getAttribute('data-tooltip') || '';
  let cleanAria = aria.replace(/^(Download|Preview|Open)?\s*(attachment)?\s*:?\s*/i, '').trim();
  if (cleanAria && cleanAria.includes('.')) return cleanAria;

  const text = link.textContent || '';
  const match = text.match(/(.*?\.[a-z0-9]{2,5})(?:\s|$)/i);
  if (match) {
    let extracted = match[1].trim();
    extracted = extracted.replace(/^(Preview|Download)?\s*(attachment)?\s*/i, '').trim();
    return extracted;
  }
  
  return `attachment_${Date.now()}`;
}

function getUniqueFilename(baseName) {
  if (!fileNameTracker.has(baseName)) {
    fileNameTracker.set(baseName, 1);
    return baseName;
  }
  let count = fileNameTracker.get(baseName);
  let newName;
  let lastDotIndex = baseName.lastIndexOf('.');
  if (lastDotIndex !== -1) {
    newName = `${baseName.substring(0, lastDotIndex)} (${count})${baseName.substring(lastDotIndex)}`;
  } else {
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
  return Array.from(document.querySelectorAll('tr.zA')).some(isVisible);
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

// --- NEW: Robust Extension Checker ---
function isAllowedExtension(filename) {
  const allowed = currentSettings.allowedExtensions || [];
  if (allowed.length === 0) return false;
  
  // Clean off query parameters from URLs hiding in filenames
  let cleanName = filename.split('?')[0].split('#')[0].trim();
  
  const extMatch = cleanName.match(/\.([a-z0-9]{2,5})$/i);
  if (!extMatch) return false; 
  
  const ext = extMatch[1].toLowerCase();
  return allowed.includes(ext);
}

// --- NEW: MIME-Type Fallback Guesser ---
// If a file lacks an extension, this guesses it from the raw data type
function inferExtension(mimeType) {
  if (!mimeType) return null;
  const mime = mimeType.toLowerCase();
  
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('rfc822') || mime.includes('message/')) return 'eml';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('csv')) return 'csv';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('zip')) return 'zip';
  if (mime.includes('json')) return 'json';
  if (mime.includes('rar')) return 'rar';
  if (mime.includes('wordprocessingml') || mime.includes('msword')) return 'docx';
  if (mime.includes('spreadsheetml') || mime.includes('excel')) return 'xlsx';
  if (mime.includes('presentationml') || mime.includes('powerpoint')) return 'pptx';
  if (mime.includes('svg')) return 'svg';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic')) return 'heic';
  if (mime === 'text/plain') return 'txt';
  
  return null;
}

async function compileAndDownloadZip() {
  const collectedAttachments = await getAllAttachmentsFromDB();

  if (collectedAttachments.length === 0) {
    reportProgress("Finished. No matching files found to zip.", true);
    chrome.storage.local.set({ isScanning: false });
    isProcessing = false;
    return;
  }

  reportProgress(`Compiling ZIP for ${collectedAttachments.length} items. Please wait...`);

  try {
    const zip = new JSZip();
    for (const file of collectedAttachments) {
      zip.file(file.name, file.blob);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const objectUrl = URL.createObjectURL(zipBlob);

    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `gmail-attachments-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    reportProgress("Download triggered successfully!", true);
  } catch (error) {
    console.error("ZIP Generation failed:", error);
    reportProgress("Error generating ZIP. Check console.", true);
  } finally {
    await clearAttachmentsDB();
    chrome.storage.local.set({ isScanning: false });
    isProcessing = false;
  }
}

async function processGmailAutomation() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const state = await chrome.storage.local.get(["isScanning", "settings"]);
    currentSettings = state.settings || { allowedExtensions: ['pdf'], skipInline: true };

    if (!state.isScanning) {
      reportProgress("Scan stopped by user. Generating ZIP...");
      await compileAndDownloadZip();
      return;
    }

    if (isListView() && !isEmailView()) {
      reportProgress("Starting from list. Opening first email...");
      const firstRow = await waitForElement('tr.zA');
      
      if (firstRow) {
        const clickable = firstRow.querySelector('div[role="link"], a[href]') || firstRow;
        clickable.click();
        await waitForElement('.a3s'); 
        isProcessing = false;
        processGmailAutomation();
        return;
      }
    }

    if (isEmailView()) {
      scanStats.emailsScanned++;
      reportProgress(`Scanning email #${scanStats.emailsScanned}...`);
      await delay(500); 

      const expandBtn = document.querySelector('[aria-label="Expand all"], img[alt="Expand all"]');
      if (expandBtn && isVisible(expandBtn)) {
        expandBtn.click();
        await delay(1000); 
      }

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
            let rawName = getCleanFilename(link);
            
            // STAGE 1 (PRE-CHECK)
            let cleanBaseName = rawName.split('?')[0].trim();
            const hasExplicitExt = /\.[a-z0-9]{2,5}$/i.test(cleanBaseName);
            if (hasExplicitExt && !isAllowedExtension(cleanBaseName)) {
                collectedUrls.add(url);
                continue;
            }

            reportProgress(`Fetching file...`);
            
            const response = await fetch(url); 
            if (!response.ok) continue;

            const disposition = response.headers.get('Content-Disposition');
            if (disposition) {
              let match = disposition.match(/filename="([^"]+)"/i);
              if (!match) match = disposition.match(/filename=([^;]+)/i);
              if (match && match[1]) {
                rawName = decodeURIComponent(match[1].trim());
              }
            }

            const blob = await response.blob();

            // STAGE 2: MIME-Type Fallback
            // If the filename STILL has no extension, ask the file data what type it is
            let cleanNameForCheck = rawName.split('?')[0].trim();
            if (!/\.[a-z0-9]{2,5}$/i.test(cleanNameForCheck)) {
                const guessedExt = inferExtension(blob.type);
                if (guessedExt) {
                    rawName += '.' + guessedExt;
                }
            }

            // STAGE 3 (POST-CHECK):
            if (!isAllowedExtension(rawName)) {
                collectedUrls.add(url);
                continue;
            }

            // Skip Inline Images Filter
            if (currentSettings.skipInline && blob.size < 10240) {
                const isImg = rawName.match(/\.(png|jpg|jpeg|gif|webp|heic)$/i) || blob.type.startsWith('image/');
                if (isImg) {
                    collectedUrls.add(url);
                    continue; 
                }
            }

            const finalName = getUniqueFilename(rawName);
            collectedUrls.add(url);
            
            scanStats.filesFound++;
            scanStats.sizeBytes += blob.size;

            await saveAttachmentToDB({ name: finalName, blob }); 
            reportProgress(`Saved: ${finalName.substring(0, 20)}...`);

          } catch (e) {
            console.error('Failed to extract file', e);
          }
        }
      }

      const nextBtn = getNextButton();
      if (nextBtn) {
        if (nextBtn.getAttribute('aria-disabled') === 'true') {
          reportProgress("End of search list reached!");
          await compileAndDownloadZip();
          return;
        }

        reportProgress("Moving to next email...");
        nextBtn.click();
        
        await delay(1500); 
        isProcessing = false;
        processGmailAutomation();
        return;
      } else {
         reportProgress("No pagination found. Ending scan.");
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
    
    isProcessing = false; 
    collectedUrls.clear();
    fileNameTracker.clear();
    scanStats = { emailsScanned: 0, filesFound: 0, sizeBytes: 0 };
    
    clearAttachmentsDB().then(() => {
        chrome.storage.local.set({ isScanning: true }, () => {
          reportProgress("Gmail automation starting...");
          processGmailAutomation();
        });
    });
    
    sendResponse({ status: "triggered" });
    return true; 
  }
});