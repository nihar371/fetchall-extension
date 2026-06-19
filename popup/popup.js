document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  const settings = await chrome.storage.local.get(['settings', 'isScanning']);
  const defaultSettings = { pdf: true, img: true, doc: true, skipInline: true };
  const currentSettings = settings.settings || defaultSettings;

  document.getElementById('filter-pdf').checked = currentSettings.pdf;
  document.getElementById('filter-img').checked = currentSettings.img;
  document.getElementById('filter-doc').checked = currentSettings.doc;
  document.getElementById('skip-inline').checked = currentSettings.skipInline;

  // Restore UI state if already scanning
  if (settings.isScanning) {
    toggleUIState(true);
  }
});

function toggleUIState(isScanning) {
  document.getElementById('settings-panel').classList.toggle('hidden', isScanning);
  document.getElementById('collectBtn').classList.toggle('hidden', isScanning);
  document.getElementById('progress-panel').classList.toggle('hidden', !isScanning);
  document.getElementById('stopBtn').classList.toggle('hidden', !isScanning);
}

document.getElementById('collectBtn').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = "Initializing...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url.includes("mail.google.com")) {
    statusDiv.textContent = "Please open Gmail search results.";
    document.getElementById('progress-panel').classList.remove('hidden');
    return;
  }

  // Save current settings to storage for content script
  const scanSettings = {
    pdf: document.getElementById('filter-pdf').checked,
    img: document.getElementById('filter-img').checked,
    doc: document.getElementById('filter-doc').checked,
    skipInline: document.getElementById('skip-inline').checked
  };

  await chrome.storage.local.set({ settings: scanSettings });

  chrome.runtime.sendMessage({ action: "startSearchLoop" }, (response) => {
    if (chrome.runtime.lastError || !response || response.status !== "initialized") {
      statusDiv.textContent = "Error starting scan.";
      return;
    }

    toggleUIState(true);

    chrome.tabs.sendMessage(tab.id, { action: "triggerScanStart" }, (tabResponse) => {
      if (chrome.runtime.lastError) {
        statusDiv.innerHTML = `<span style="color:#ff5252;">Please <b>refresh</b> your Gmail tab.</span>`;
        toggleUIState(false);
      }
    });
  });
});

document.getElementById('stopBtn').addEventListener('click', async () => {
  document.getElementById('status').textContent = "Stopping scan and zipping files...";
  document.getElementById('stopBtn').disabled = true;
  document.getElementById('stopBtn').textContent = "Processing...";
  
  // Changing the flag will trigger graceful stop in content.js loop
  await chrome.storage.local.set({ isScanning: false });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "progressUpdate") {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message.text;

    if (message.stats) {
      document.getElementById('stat-emails').textContent = message.stats.emailsScanned;
      document.getElementById('stat-files').textContent = message.stats.filesFound;
      document.getElementById('stat-size').textContent = message.stats.sizeMb;
      
      // Indeterminate progress animation while running
      document.getElementById('scan-progress').removeAttribute('value');
    }

    // Reset UI if scan is completely finished
    if (message.finished) {
      document.getElementById('scan-progress').setAttribute('value', '100');
      document.getElementById('stopBtn').disabled = false;
      document.getElementById('stopBtn').textContent = "Stop & Zip Data";
      setTimeout(() => toggleUIState(false), 3000);
    }
  }
});