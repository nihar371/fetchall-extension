document.getElementById('collectBtn').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = "Initializing script loop...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab || !tab.url.includes("mail.google.com")) {
    statusDiv.textContent = "Please open Gmail search results page.";
    return;
  }

  // Initiating background engine run
  chrome.runtime.sendMessage({ action: "startSearchLoop" }, (response) => {
    if (chrome.runtime.lastError) {
      statusDiv.textContent = `Error starting scan: ${chrome.runtime.lastError.message}`;
      return;
    }
    if (!response || response.status !== "initialized") {
      statusDiv.textContent = "Error starting scan.";
      return;
    }

    // Trigger content script directly, failing immediately on error
    chrome.tabs.sendMessage(tab.id, { action: "triggerScanStart" }, (tabResponse) => {
      if (chrome.runtime.lastError) {
        statusDiv.textContent = "Error: Could not connect to Gmail tab. Please refresh the Gmail page and try again.";
        console.error("Connection failed:", chrome.runtime.lastError.message);
        return;
      }
      statusDiv.textContent = "Scan running! Keep this tab visible.";
    });
  });
});

// Update extension popup text
chrome.runtime.onMessage.addListener((message) => {
  const statusDiv = document.getElementById('status');
  if (message.action === "updateStatus" && statusDiv) {
    statusDiv.textContent = message.text;
  }
});