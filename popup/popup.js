document.getElementById('collectBtn').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = "Initializing script loop...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab || !tab.url.includes("mail.google.com")) {
    statusDiv.textContent = "Error: Please open Gmail search results page.";
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

    // Retry sending triggerScanStart if content script isn't ready yet
    let retries = 0;
    const maxRetries = 5;
    const sendTrigger = () => {
      chrome.tabs.sendMessage(tab.id, { action: "triggerScanStart" }, (tabResponse) => {
        if (chrome.runtime.lastError) {
          if (retries < maxRetries) {
            retries++;
            statusDiv.textContent = `Waiting for Gmail to load... (attempt ${retries}/${maxRetries})`;
            setTimeout(sendTrigger, 1000);
          } else {
            statusDiv.textContent = "Error: Could not connect to Gmail tab. Reload the page and try again.";
          }
          return;
        }
        statusDiv.textContent = "Scan running! Keep this tab visible.";
      });
    };
    sendTrigger();
  });
});

// Update the extension popup text dynamically while scanning progresses
chrome.runtime.onMessage.addListener((message) => {
  const statusDiv = document.getElementById('status');
  if (message.action === "updateStatus" && statusDiv) {
    statusDiv.textContent = message.text;
  }
});
