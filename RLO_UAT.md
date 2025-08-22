# Rumble Live Ops - User Acceptance Tests (UAT)

This document outlines the User Acceptance Tests (UAT) for the Rumble Live Ops Chrome extension.

---

## **Options Page (`options.html`)**

### **Quick Links**

- **Test Case:** Click on "Rumble Studio" link.
  - **Expected Result:** A new tab opens to `https://studio.rumble.com/home`.
    - ✅
- **Test Case:** Click on "Campaigns" link.
  - **Expected Result:** A new tab opens to `https://studio.rumble.com/campaigns`.
    - ✅
- **Test Case:** Click on "Dashboard" link.
  - **Expected Result:** A new tab opens to `https://rumble.com/account/dashboard?type=earnings&interval=30`.
    - ✅
- **Test Case:** Click on "Next Live Stream" link.
  - **Expected Result:** If a live stream is scheduled or in progress, a new tab opens to the stream URL. Otherwise, the link is inactive.
    - ✅

---

### **API & User**

- **Test Case:** Enter an invalid Rumble API key and click "Save Key".
  - **Expected Result:** An error toast message appears, and the "Verification Info" section remains blank or shows an error state.
    - ✅
- **Test Case:** Enter a valid Rumble API key and click "Save Key".
  - **Expected Result:** A success toast message appears. The "Verification Info" section populates with the correct username, follower count, and livestream status.
    - ✅
- **Test Case:** Click "Fetch Playlists".
  - **Expected Result:** A success toast message appears, and the "My Playlists" section populates with the user's playlists.
    - ✅
- **Test Case:** Click "Fetch All My Videos".
  - **Expected Result:** A success toast message appears, and the "Video & Playlist Manager" section populates with all of the user's videos.
    - ✅

---

### **Enable Functions**

- **Test Case:** Toggle "Streamer Mode".
  - **Expected Result:** The toggle state is saved. When enabled, sensitive information on Rumble account pages is blurred or hidden.
    - ✅
- **Test Case:** Toggle "Raid Button on Live Streams".
  - **Expected Result:** The toggle state is saved. When enabled, a raid button appears on live stream pages.
    - ✅
- **Test Case:** Toggle "Raid Button on Rumble Studio".
  - **Expected Result:** The toggle state is saved. When enabled, a raid button appears on the Rumble Studio page.
    - ✅
- **Test Case:** Toggle "Gifted Subs on Live Stream".
  - **Expected Result:** The toggle state is saved. When enabled, gifted sub notifications are visible on the live stream chat.
    - ✅
- **Test Case:** Toggle "Followers on Rumble Studio".
  - **Expected Result:** The toggle state is saved. When enabled, a follower count is displayed in Rumble Studio.
    - ✅
- **Test Case:** Toggle "Followers on Live Stream".
  - **Expected Result:** The toggle state is saved. When enabled, a follower count is displayed on the live stream page.
    - ✅
- **Test Case:** Toggle "Gamify Dashboard".
  - **Expected Result:** The toggle state is saved. When enabled, the gamified dashboard with stars and progress bars is visible on the earnings dashboard.
    - ✅
- **Test Case:** Toggle "Hide Campaigns (per advertiser)".
  - **Expected Result:** The toggle state is saved. When enabled, a "Hide" control appears for each campaign, allowing the user to hide advertisers.
    - ✅
- **Test Case:** Toggle "Custom Raid/Rant Chat Styling".
  - **Expected Result:** The toggle state is saved. When enabled, custom CSS styles are applied to raid and rant messages in the chat.
    - ✅
- **Test Case:** Toggle "Enable Clips Command".
  - **Expected Result:** The toggle state is saved. When enabled, a "!clip" command button is available in the chat.
    - ✅

---

### **Background Images Manager**

- **Test Case:** Upload a valid image file and click "Add Image".
  - **Expected Result:** The image is added to the list of backgrounds, and a success toast message appears.
    - ✅
- **Test Case:** Select a background from the list and click "Set Default".
  - **Expected Result:** The selected background is set as the default, and a success toast message appears.
    - ✅
- **Test Case:** Click "Use Default Background".
  - **Expected Result:** The default background is applied, and a success toast message appears.
    - ✅
- **Test Case:** Delete a background from the list.
  - **Expected Result:** The selected background is removed from the list, and a success toast message appears.
    - ✅

---

### **Custom Sounds Manager**

- **Test Case:** Upload a valid audio file and click "Add Raid Sound".
  - **Expected Result:** The sound is added to the list of raid sounds, and a success toast message appears.
    - ✅
- **Test Case:** Upload a valid audio file and click "Add Rant Sound".
  - **Expected Result:** The sound is added to the list of rant sounds, and a success toast message appears.
    - ✅
- **Test Case:** Select a sound and click "Set Default" for raid sounds.
  - **Expected Result:** The selected sound becomes the default for raid alerts.
    - ✅
- **Test Case:** Select a sound and click "Set Default" for rant sounds.
  - **Expected Result:** The selected sound becomes the default for rant alerts.
    - ✅
- **Test Case:** Play a sound from the list.
  - **Expected Result:** The selected sound plays.
    - ✅
- **Test Case:** Delete a sound from the list.
  - **Expected Result:** The selected sound is removed from the list.
    - ✅

---

### **Video & Playlist Manager**

- **Test Case:** Filter videos by title.
  - **Expected Result:** The video list is filtered to show only videos matching the search term.
    - ✅
- **Test Case:** Select all videos.
  - **Expected Result:** All videos in the list are selected.
    - ✅
- **Test Case:** Clear video selection.
  - **Expected Result:** All selected videos are deselected.
    - ✅
- **Test Case:** With videos selected, click "Manage Playlists".
  - **Expected Result:** The "Manage Playlists" modal opens.
    - ✅
- **Test Case:** In the modal, select playlists and click "Apply to selected videos".
  - **Expected Result:** The selected videos are added to the chosen playlists, and a success toast appears.
    - ✅
- **Test Case:** With videos selected, click "Clear Playlists".
  - **Expected Result:** The selected videos are removed from all playlists, and a success toast appears.
    - ✅

---

### **Simulate & Maintenance**

- **Test Case:** Click "Simulate Received RAID".
  - **Expected Result:** A test raid notification appears on the active Rumble Studio or Live tab.
    - ✅
- **Test Case:** Click "Simulate Received RANT".
  - **Expected Result:** A test rant notification appears on the active Rumble Studio or Live tab.
    - ✅
- **Test Case:** Click "Test RAID Popup".
  - **Expected Result:** A test raid popup appears on the active Rumble Studio or Live tab.
    - ✅
- **Test Case:** Click "Reset Advert Filters".
  - **Expected Result:** All hidden advertisers are unhidden, and a success toast appears.
    - ✅

---

## **Rumble & Rumble Studio Pages**

### **Raid Functionality**

- **Test Case:** On a live stream page, press **Alt + Right Click**.
  - **Expected Result:** The raid modal appears, allowing the user to select a channel to raid.
    - ☑️ Disabled in favour of the button process
- **Test Case:** Click the "Raid" button in Rumble Studio.
  - **Expected Result:** The raid modal appears.
    - ✅
- **Test Case:** Click the "Raid" button on a live stream page.
  - **Expected Result:** The raid modal appears.
    - ✅
- **Test Case:** Attempt to raid a channel you don't own.
  - **Expected Result:** An error message appears, preventing the raid.
    - ✅

---

### **Streamer Mode**

- **Test Case:** Navigate to `/account/profile` with Streamer Mode enabled.
  - **Expected Result:** Sensitive information in the "Payment Info" section is blurred or hidden.
    - ✅
- **Test Case:** Navigate to `/account/verification` with Streamer Mode enabled.
  - **Expected Result:** Verified phone numbers are hidden.
    - ✅
- **Test Case:** Navigate to `/account/recurring-subs` with Streamer Mode enabled.
  - **Expected Result:** The "Rumble Subscriptions" section is hidden.
    - ✅
- **Test Case:** Navigate to `/account/dashboard` with Streamer Mode enabled.
  - **Expected Result:** Earnings figures and charts are blurred.
    - ✅

---

### **Gamify Dashboard**

- **Test Case:** Navigate to `/account/dashboard?interval=30` with "Gamify Dashboard" enabled.
  - **Expected Result:** The dashboard displays XP-style stars and progress overlays.
    - ✅

---

### **Campaign Hiding**

- **Test Case:** On the `/campaigns` page, click the "Hide" checkbox for an advertiser.
  - **Expected Result:** The advertiser's campaigns are hidden from the list.
    - ✅
- **Test Case:** On the `/studio/passthrough` page, click the "Hide" checkbox for an advertiser.
  - **Expected Result:** The advertiser's campaigns are hidden.
    - ✅

---

### **Chat Features**

- **Test Case:** Receive a raid or rant in the chat with custom styling enabled.
  - **Expected Result:** The raid/rant message has custom CSS styles applied.
    - ✅
- **Test Case:** Click the "!clip" button in the chat.
  - **Expected Result:** The `!clip` command is sent to the chat.
    - ✅
- **Test Case:** On a live stream, observe the chat.
  - **Expected Result:** All chat messages have timestamps.
    - ✅
