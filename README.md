# FetchAll

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue)
![License](https://img.shields.io/badge/License-MIT-green)

**FetchAll** is a Google Chrome extension that automatically downloads all attachments from a Gmail thread or search result into a single `.zip` file. 

## Key Features

* **One-Click Export:** Download dozens of files from Gmail search results without opening emails individually.
* **Smart Renaming:** Automatically cleans up messy Gmail file names and numbers duplicates (e.g., `report (1).pdf`) to prevent data loss.
* **100% Private:** Runs entirely locally in your browser. No external APIs, and no data ever leaves your machine.

## Installation

Currently, FetchAll is installed manually via Chrome's Developer Mode.

1. Clone or download this repository to your computer.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Toggle on **Developer mode** (top right corner).
4. Click **Load unpacked** and select the folder containing the `manifest.json` file.
5. Pin the FetchAll icon to your browser toolbar.

## Quick Start

1. Open Gmail and enter a search (for example: `has:attachment from:client@company.com`).
2. Click the FetchAll icon in your toolbar.
3. Click **Start Automated Scan**.
4. Leave the tab open while it scans. Once finished, a `.zip` file will automatically download.

## License

[MIT](LICENSE)