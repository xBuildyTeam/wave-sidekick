# Wave Sidekick — Chrome Extension

Wave OS Assistant in your browser. Chat, memory, Chief of Staff actions, and voice input from any tab.

## Features

### Chat & AI
- **Side Panel Chat** — Full Wave Assistant chat powered by `waveChat.ts` backend
- **Voice Input** — Tap the mic button to speak. Live transcription via Web Speech API with interim results shown as you talk. Auto-sends on pause (configurable in Settings).
- **Persistent Memory** — Save and recall facts across sessions via `AssistantMemory` entity

### Browser Integration
- **Floating Orb** — Click the teal/purple orb on any page to open the side panel. Drag to reposition.
- **Page Context Awareness** — Extracts page title, URL, selected text, and headings. Auto-injected into chat context so you can say "summarize this" and it knows what "this" is.
- **Right-Click Actions** — Select text on any page → right-click → "Ask Wave Assistant" or "Save to Wave Memory"

### Chief of Staff
- **Quick Actions** — One-tap access:
  - 📅 Briefing — Morning briefing (calendar, credits, tasks, notifications)
  - ⚡ Triage — Urgency-ranked system check
  - ✅ Follow-ups — Overdue/due-today/upcoming task scan
  - 🧠 Memory — View all saved memories grouped by category

### Design
- **Glassmorphism UI** — Dark navy + teal/purple gradients matching Wave OS aesthetic

## Voice Input Details

The mic button uses Chrome's Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`):

- **Live transcription** — Interim results appear in real-time as you speak
- **Auto-send on silence** — Stops after 2.5s of silence and sends automatically (toggleable in Settings)
- **Manual mode** — Disable auto-send to review/edit the transcript before sending
- **8 languages** — English (US/UK), Spanish, French, German, Japanese, Chinese, Portuguese
- **Visual feedback** — Pulsing red mic button, animated voice overlay with waveform bars, interim text display

**Settings (Settings panel):**
- Auto-send on/off toggle
- Voice language selector
- These persist across browser sessions via `chrome.storage.local`

## Setup

### 1. Load the Extension
1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `wave-sidekick/` folder

### 2. Connect to Wave OS
1. Open the side panel (click the Wave icon in the toolbar, or the floating orb)
2. Paste your Wave OS auth token (from `oswave.io → Settings → Developer`)
3. Optionally set a Workspace ID (default: `wave-default`)
4. Click **Connect to Wave OS**

### 3. Using Voice
1. Click the **mic button** (🎙️) in the input bar
2. Chrome will ask for microphone permission — allow it
3. Speak — your words appear as you talk
4. Stop speaking for 2.5s → message auto-sends (or press mic again to stop early)
5. In Settings, you can disable auto-send to review before sending

### 4. Using It
- Click the floating orb on any page to open the side panel
- Use quick action buttons for Chief of Staff functions
- Select text → right-click → "Ask Wave Assistant" or "Save to Wave Memory"
- The 📄 button in the header grabs page context manually

## Architecture

```
wave-sidekick/
├── manifest.json      # Manifest V3 config
├── background.js       # Service worker — API calls, context menu, tab management
├── content.js          # Content script — floating orb, page context extraction
├── content.css         # Orb styles with glassmorphism glow
├── sidepanel.html      # Side panel UI (chat, voice, settings)
├── sidepanel.css       # Glassmorphism theme + voice/mic styles
├── sidepanel.js        # Chat, voice (Web Speech API), quick actions, settings
└── icons/              # Extension icons (16, 48, 128px)
```

## Backend Functions Used

| Function | Action | Purpose |
|----------|--------|---------|
| `waveChat` | `chat` | AI chat with Theta AI + page context |
| `waveChat` | `saveMemory` | Save facts to AssistantMemory entity |
| `waveChat` | `listMemory` | List all memories grouped by category |
| `waveChat` | `recallMemory` | Search memories by query/tags |
| `waveChat` | `deleteMemory` | Delete a memory by ID |
| `waveChiefOfStaff` | `morningBriefing` | Calendar + credits + tasks summary |
| `waveChiefOfStaff` | `triage` | Urgency-ranked system health check |
| `waveChiefOfStaff` | `followUpScan` | Overdue/due-today/upcoming tasks |

## Permissions

- `sidePanel` — Open as a browser side panel
- `storage` — Store auth token, voice settings, and config
- `activeTab` — Access current tab for context extraction
- `scripting` — Inject content scripts
- `contextMenus` — Right-click "Ask Wave Assistant" / "Save to Wave Memory"
- `tabs` — Monitor tab changes for orb injection

## Browser Support

- **Chrome 114+** — Full support (sidePanel API + Web Speech API)
- **Edge 114+** — Full support (Chromium-based)
- **Firefox** — Side panel not supported; voice not available (no Web Speech API)

## Future Enhancements

- Text-to-speech (AI responses read aloud)
- Screenshot capture → send to Assistant
- Per-site orb toggle (hide on specific domains)
- Deep linking to Wave OS apps (Surge, Files, Notes)
- Multi-workspace switching
- Auto-save page context as notes
- GitHub integration (when on GitHub, offer "Send to Surge")
