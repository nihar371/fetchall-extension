document.getElementById('collectBtn').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = "Initializing script loop...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab || !tab.url.includes("mail.google.com")) {
    statusDiv.textContent = "Please open Gmail search results page.";
    return;
  }

  // Wake up the background engine and let it know we are initiating a run
  chrome.runtime.sendMessage({ action: "startSearchLoop" }, (response) => {
    if (chrome.runtime.lastError) {
      statusDiv.textContent = `Error starting scan: ${chrome.runtime.lastError.message}`;
      return;
    }
    if (!response || response.status !== "initialized") {
      statusDiv.textContent = "Error starting scan.";
      return;
    }

    // Send the trigger to the content script directly, failing immediately on error
    chrome.tabs.sendMessage(tab.id, { action: "triggerScanStart" }, (tabResponse) => {
      if (chrome.runtime.lastError) {
        // If the content script isn't attached (e.g., page wasn't refreshed after extension update), fail fast.
        statusDiv.textContent = "Error: Could not connect to Gmail tab. Please refresh the Gmail page and try again.";
        console.error("Connection failed:", chrome.runtime.lastError.message);
        return;
      }
      statusDiv.textContent = "Scan running! Keep this tab visible.";
    });
  });
});

// Update the extension popup text dynamically while scanning progresses
chrome.runtime.onMessage.addListener((message) => {
  const statusDiv = document.getElementById('status');
  if (message.action === "updateStatus" && statusDiv) {
    statusDiv.textContent = message.text;
  }
});