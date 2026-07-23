# Wave Sidekick — Firefox Edition

Wave OS Assistant in your Firefox browser. Chat, memory, Chief of Staff actions, and voice input from any tab.

## Differences from Chrome Edition

| Feature | Chrome | Firefox |
|---------|--------|---------|
| Manifest | V3 | V2 |
| Panel | `sidePanel` API | `sidebar_action` API |
| Background | Service Worker | Background Script |
| Action button | `action` | `browser_action` |
| Voice Input (STT) | ✅ Web Speech API | ⚠️ Limited (no `webkitSpeechRecognition`) |
| Text-to-Speech (TTS) | ✅ Full support | ✅ Full support |
| Heartbeat | ✅ | ✅ |

## Setup

### 1. Load the Extension
1. Open Firefox → `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select the `manifest.json` file in the `wave-sidekick-firefox/` folder

### 2. Connect to Wave OS
1. Open the sidebar (View → Sidebar → Wave Sidekick, or click the toolbar icon)
2. Paste your Wave OS auth token
3. Click **Connect to Wave OS**

### 3. Using It
- The floating orb appears on all pages — click to open the sidebar
- Use quick action buttons for Chief of Staff functions
- Select text → right-click → "Ask Wave Assistant" or "Save to Wave Memory"
- TTS works fully — speaker icon reads responses aloud
- STT may not work (Firefox lacks `webkitSpeechRecognition`) — mic button will be disabled if unavailable
