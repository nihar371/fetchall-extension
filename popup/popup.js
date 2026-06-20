// --- State Management ---
let activeExtensions = new Set();

// Map specific extensions to handle combined cases (like .jpg/.jpeg)
const extensionEquivalents = {
  'jpg': ['jpg', 'jpeg'],
  'docx': ['docx', 'doc'],
  'xlsx': ['xlsx', 'xls'],
  'pptx': ['pptx', 'ppt']
};

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Load saved settings or defaults
  const data = await chrome.storage.local.get(['settings', 'isScanning']);
  
  // Default extensions including the newly added video and heic formats
  const defaultExts = ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'doc', 'csv', 'xlsx', 'xls', 'heic', 'mp4'];
  
  if (data.settings && data.settings.allowedExtensions) {
    data.settings.allowedExtensions.forEach(ext => activeExtensions.add(ext));
  } else {
    defaultExts.forEach(ext => activeExtensions.add(ext));
  }
  
  document.getElementById('skip-inline').checked = data.settings ? data.settings.skipInline : true;

  // 2. Initialize UI
  updateCheckboxesFromState();
  renderTags();
  if (data.isScanning) {
    toggleUIState(true);
  }

  // 3. Event Listeners for Checkboxes
  document.querySelectorAll('.child-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const ext = e.target.value;
      const relatedExts = extensionEquivalents[ext] || [ext];
      
      if (e.target.checked) {
        relatedExts.forEach(x => activeExtensions.add(x));
      } else {
        relatedExts.forEach(x => activeExtensions.delete(x));
      }
      renderTags();
      syncParentCheckboxes();
    });
  });

  document.querySelectorAll('.parent-checkbox').forEach(parentCb => {
    parentCb.addEventListener('change', (e) => {
      const groupName = e.target.dataset.group;
      const children = document.querySelectorAll(`#group-${groupName} .child-checkbox`);
      const isChecked = e.target.checked;

      children.forEach(cb => {
        cb.checked = isChecked;
        const ext = cb.value;
        const relatedExts = extensionEquivalents[ext] || [ext];
        if (isChecked) {
          relatedExts.forEach(x => activeExtensions.add(x));
        } else {
          relatedExts.forEach(x => activeExtensions.delete(x));
        }
      });
      renderTags();
      e.target.indeterminate = false;
    });
  });

  // 4. Event Listener for Custom Input
  document.getElementById('add-ext-btn').addEventListener('click', handleCustomInput);
  document.getElementById('custom-ext-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleCustomInput();
  });

  // 5. Action Buttons
  document.getElementById('collectBtn').addEventListener('click', startScan);
  document.getElementById('stopBtn').addEventListener('click', stopScan);
});

// --- UI & State Logic Functions ---

function toggleUIState(isScanning) {
  document.getElementById('settings-panel').classList.toggle('hidden', isScanning);
  document.getElementById('collectBtn').classList.toggle('hidden', isScanning);
  document.getElementById('progress-panel').classList.toggle('hidden', !isScanning);
  document.getElementById('stopBtn').classList.toggle('hidden', !isScanning);
}

function handleCustomInput() {
  const inputEl = document.getElementById('custom-ext-input');
  const rawValue = inputEl.value;
  if (!rawValue.trim()) return;

  const exts = rawValue.split(',')
    .map(ext => ext.trim().replace(/^\./, '').toLowerCase()) // Remove dots and spaces
    .filter(ext => ext.length > 0);

  exts.forEach(ext => activeExtensions.add(ext));
  inputEl.value = ''; // Clear input
  
  updateCheckboxesFromState();
  renderTags();
}

function removeExtension(extToRemove) {
  activeExtensions.delete(extToRemove);
  // Also remove equivalents if they exist (e.g., removing jpg removes jpeg)
  for (const [key, equivalents] of Object.entries(extensionEquivalents)) {
    if (equivalents.includes(extToRemove)) {
      equivalents.forEach(x => activeExtensions.delete(x));
    }
  }
  updateCheckboxesFromState();
  renderTags();
}

function renderTags() {
  const container = document.getElementById('tags-container');
  container.innerHTML = ''; // Clear current

  if (activeExtensions.size === 0) {
    container.innerHTML = `<span style="color:#666; font-size:11px;">No formats selected...</span>`;
    return;
  }

  // Create an array to sort alphabetically for neatness
  const sortedExts = Array.from(activeExtensions).sort();

  sortedExts.forEach(ext => {
    const tag = document.createElement('div');
    tag.className = 'ext-tag';
    
    const label = document.createElement('span');
    label.textContent = `.${ext}`;
    
    const closeBtn = document.createElement('span');
    closeBtn.className = 'tag-remove';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = () => removeExtension(ext);

    tag.appendChild(label);
    tag.appendChild(closeBtn);
    container.appendChild(tag);
  });
}

function updateCheckboxesFromState() {
  // 1. Update child checkboxes
  document.querySelectorAll('.child-checkbox').forEach(cb => {
    const ext = cb.value;
    // If the base extension is in the set, check it
    cb.checked = activeExtensions.has(ext);
  });
  
  // 2. Update parent checkboxes & indeterminate states
  syncParentCheckboxes();
}

function syncParentCheckboxes() {
  document.querySelectorAll('.parent-checkbox').forEach(parent => {
    const groupName = parent.dataset.group;
    const children = document.querySelectorAll(`#group-${groupName} .child-checkbox`);
    
    let checkedCount = 0;
    children.forEach(cb => { if (cb.checked) checkedCount++; });

    if (checkedCount === 0) {
      parent.checked = false;
      parent.indeterminate = false;
    } else if (checkedCount === children.length) {
      parent.checked = true;
      parent.indeterminate = false;
    } else {
      parent.checked = false;
      parent.indeterminate = true; // Shows the dash
    }
  });
}

// --- Scanning Process Logic ---

async function startScan() {
  const statusDiv = document.getElementById('status');
  
  if (activeExtensions.size === 0) {
    statusDiv.textContent = "Please select at least one format.";
    statusDiv.style.color = "#ff5252";
    return;
  }
  statusDiv.style.color = "#aaa";
  statusDiv.textContent = "Initializing...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url.includes("mail.google.com")) {
    statusDiv.textContent = "Please open Gmail search results.";
    document.getElementById('progress-panel').classList.remove('hidden');
    return;
  }

  // Save the explicit array of extensions rather than booleans
  const scanSettings = {
    allowedExtensions: Array.from(activeExtensions),
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
}

async function stopScan() {
  document.getElementById('status').textContent = "Stopping scan and zipping files...";
  document.getElementById('stopBtn').disabled = true;
  document.getElementById('stopBtn').textContent = "Processing...";
  
  // Changing the flag will trigger graceful stop in content.js loop
  await chrome.storage.local.set({ isScanning: false });
}

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