# Rumble Live Ops (Raid Helper+) 🚀

A Chrome Extension to assist streamers on **Rumble** with raids, analytics, playlists, and streamlined live operations.

---

## 📜 Change Log

-   **v4.0** – Major Rebuild & Feature Expansion
    -   **Core Architecture**: Introduced **offscreen parsing** for more reliable and efficient data scraping from Rumble pages.
    -   **Playlist Management**:
        -   Added **Playlist Automator** to bulk "Set" and "Clear" playlists for multiple videos.
        -   Implemented a progress bar to track bulk operations.
    -   **Privacy & UX**:
        -   Introduced **Streamer Mode** to blur or hide sensitive information (earnings, personal details) for safe screen-sharing.
        -   Added **Gamify Dashboard** to provide visual progress overlays (stars, XP-style bars) on the 30-day earnings dashboard.
    -   **Raid System Overhaul**:
        -   Raid targets are now fetched primarily from the user's channel page, with a fallback to the `/following` page, ensuring accuracy.
        -   Implemented an **Ownership Guard** to prevent accidental raids on channels you don't own.
        -   The raid button's styling now adapts to its location (Rumble Studio vs. Live Stream page).
    -   **UI Enhancements**:
        -   Redesigned the options page with a more consistent and polished look.
        -   Improved modals and popups for a cleaner user experience.

-   **v3.3** – UX Update
    -   Added a popup confirmation after pressing the Raid button.

-   **v3.2** – Chat Compatibility
    -   Adjusted for Rumble Studio changes to raid/chat detection.
    -   General bug fixes.

-   **v3.1** – Minor Rewrite
    -   Reduced API calls to a minimum when not live.

-   **v3.0** – Major Rewrite
    -   Enabled functionality in both **LIVE Stream** and **Rumble Studio** (Direct RTMP only).

---

## ⚡ Features

-   **Raid Button**: Automatically added to the **Rumble Studio** and **Live Stream header**.
-   **Ownership Verification**: Prevents attempting raids on streams you don’t own.
-   **Stream Status Detection**: Detects both **Live** and **Scheduled** streams with accurate status display.
-   **Centralized Modals**: A clean, center-screen modal for raid target selection and other interactions.
-   **Gamify Dashboard**: Adds XP-style stars and a multi-tier progress meter to your earnings dashboard.
-   **Streamer Mode**: Blurs, hides, and secures sensitive on-screen information for privacy.
-   **Playlist Automator**: Apply or clear playlists across multiple videos in bulk.
-   **Video Harvester**: Fetches your entire video catalog from Rumble for local management.
-   **Cross-Browser Support**:
    -   Chrome
    -   Brave
    -   Edge
    -   Opera / Opera GX
    -   Vivaldi
    -   (Firefox port in progress 🔧)

---

## 🛠 User Functions

Once installed and configured, you’ll have access to:

### 🎯 Raids

-   **Raid Button**: A dedicated button is added to the UI in both Rumble Studio and on Live Stream pages for easy access.
-   **Ownership Guard**: The raid functionality is only enabled on streams you own, preventing accidental raids.

### 🎥 Stream Status

-   Detects your **Next Scheduled Stream** and **Currently Live** stream.
-   The options page displays metadata for your upcoming or live stream with a direct link.

### 📂 Playlists

-   **Harvest Playlists**: Fetches all playlists associated with your channel.
-   **Bulk Playlist Apply**: Add selected videos to one or more playlists at once.
-   **Clear All Playlists**: Remove selected videos from all playlists they belong to.

### 📺 Video Harvest

-   **Fetch All Videos**: Pulls a complete list of your videos from Rumble.
-   Stores the video list locally for faster operations.

### 🎮 Gamify Dashboard

-   Adds visual progress indicators like stars and multi-level progress bars on the `/account/dashboard?interval=30` page.
-   This feature can be toggled in the Options.

### 🛡 Streamer Mode

-   Obscures sensitive information like earnings, payment details, and verified phone numbers.
-   Ideal for maintaining privacy while streaming or screen-sharing your account pages.

### 🔔 Alerts

-   Provides clear feedback through center-screen popups and top-right toast messages.
-   Includes optional audio alerts for incoming raids and rants.

---

## 📦 Installation for Chrome / Brave / Edge / Opera / Vivaldi

1.  Download the ZIP file and extract it to a local folder.
2.  Open your browser's extension management page (e.g., `chrome://extensions`).
3.  Enable **"Developer mode"**.
4.  Click **"Load unpacked"** and select the folder where you extracted the files.

## 📦 Working and Tested

1.  Please review `RLO_UAT.md` for a complete list of tested features and their status.