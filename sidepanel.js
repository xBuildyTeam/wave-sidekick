// Wave Sidekick — Side Panel Logic
// Chat, memory, CoS actions, voice input (STT), and text-to-speech (TTS)

let pageContext = null;
let isTyping = false;
let lastAssistantText = "";

// --- Voice Input State (STT) ---
let recognition = null;
let isRecording = false;
let voiceAutoSend = true;
let voiceLang = "en-US";
let finalTranscript = "";
let silenceTimer = null;
let silenceTimeout = 2500;

// --- TTS State ---
let ttsAutoRead = false;
let ttsVoiceURI = "";
let ttsRate = 1.0;
let ttsPitch = 1.0;
let isSpeaking = false;
let availableVoices = [];


// --- Conversation Sync State ---
let conversationId = null;
let lastSyncTime = null;
let syncInterval = null;
let isSyncing = false;
let knownMessageIds = new Set();

// --- DOM Elements ---
const authGate = document.getElementById("auth-gate");
const mainPanel = document.getElementById("main-panel");
const settingsPanel = document.getElementById("settings-panel");
const messagesEl = document.getElementById("messages");
const chatInput = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");
const typingIndicator = document.getElementById("typing-indicator");
const contextBanner = document.getElementById("context-banner");
const creditInfo = document.getElementById("credit-info");
const micBtn = document.getElementById("mic-btn");
const micIcon = micBtn.querySelector(".mic-icon");
const micStopIcon = micBtn.querySelector(".mic-stop-icon");
const voiceOverlay = document.getElementById("voice-overlay");
const voiceStatus = document.getElementById("voice-status");
const voiceInterim = document.getElementById("voice-interim");
const voiceHint = document.getElementById("voice-hint");
const speakBtn = document.getElementById("speak-btn");
const stopSpeakBtn = document.getElementById("stop-speak-btn");
const ttsIndicator = document.getElementById("tts-indicator");
const ttsStopBtn = document.getElementById("tts-stop");

// --- Init ---
(async function init() {
  const config = await getConfig();
  if (config && config.authToken) {
    showMainPanel();
    fetchCredits();
    chrome.runtime.sendMessage({ type: "START_HEARTBEAT" });
    initConversation();
  } else {
    showAuthGate();
  }

  // Load voice settings
  voiceAutoSend = config.voiceAutoSend !== false;
  voiceLang = config.voiceLang || "en-US";
  ttsAutoRead = config.ttsAuto === true;
  ttsVoiceURI = config.ttsVoiceURI || "";
  ttsRate = config.ttsRate || 1.0;
  ttsPitch = config.ttsPitch || 1.0;

  // Init Speech Recognition (STT)
  initSpeechRecognition();

  // Init Speech Synthesis (TTS)
  initSpeechSynthesis();

  // Check for pending action (from context menu)
  const pending = await chrome.storage.local.get("pendingAction");
  if (pending.pendingAction) {
    await chrome.storage.local.remove("pendingAction");
    handlePendingAction(pending.pendingAction);
  }
})();

// ============ TEXT-TO-SPEECH (TTS) ============

function initSpeechSynthesis() {
  if (!window.speechSynthesis) {
    console.warn("[Wave Sidekick] Speech Synthesis not available");
    speakBtn.style.display = "none";
    return;
  }

  // Load voices (async in some browsers)
  loadVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
}

function loadVoices() {
  availableVoices = window.speechSynthesis.getVoices();
  const voiceSelect = document.getElementById("settings-tts-voice");
  if (!voiceSelect) return;

  // Keep the "System Default" option
  const currentVal = voiceSelect.value;
  while (voiceSelect.options.length > 1) {
    voiceSelect.remove(1);
  }

  for (const voice of availableVoices) {
    const opt = document.createElement("option");
    opt.value = voice.voiceURI;
    opt.textContent = `${voice.name} (${voice.lang})${voice.default ? " ★" : ""}`;
    voiceSelect.appendChild(opt);
  }

  if (currentVal) voiceSelect.value = currentVal;
}

function speak(text) {
  if (!window.speechSynthesis) return;

  // Stop any current speech
  window.speechSynthesis.cancel();

  // Strip markdown/HTML for cleaner speech
  let cleanText = text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .replace(/📊|📅|⚡|✅|🧠|💾|🔴|🟡|🟢|🌊|🎉|⚠️|📄/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleanText) return;

  // Split into chunks for long text (Chrome has ~32k char limit)
  const chunks = [];
  const maxLen = 200;
  const sentences = cleanText.split(/(?<=[.!?])\s+/);
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length > maxLen) {
      if (current) chunks.push(current);
      current = sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }
  if (current) chunks.push(current);

  // Speak each chunk sequentially
  let chunkIndex = 0;

  function speakChunk() {
    if (chunkIndex >= chunks.length) {
      stopSpeaking();
      return;
    }

    const utter = new SpeechSynthesisUtterance(chunks[chunkIndex]);
    utter.rate = ttsRate;
    utter.pitch = ttsPitch;

    // Find selected voice
    if (ttsVoiceURI) {
      const voice = availableVoices.find((v) => v.voiceURI === ttsVoiceURI);
      if (voice) utter.voice = voice;
    }

    utter.onend = () => {
      chunkIndex++;
      if (chunkIndex < chunks.length && isSpeaking) {
        speakChunk();
      } else {
        stopSpeaking();
      }
    };

    utter.onerror = () => {
      console.warn("[Wave Sidekick] TTS error on chunk", chunkIndex);
      stopSpeaking();
    };

    window.speechSynthesis.speak(utter);
  }

  isSpeaking = true;
  speakBtn.style.display = "none";
  stopSpeakBtn.style.display = "flex";
  stopSpeakBtn.classList.add("speaking");
  ttsIndicator.style.display = "flex";
  speakChunk();
}

function stopSpeaking() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  isSpeaking = false;
  speakBtn.style.display = "flex";
  stopSpeakBtn.style.display = "none";
  stopSpeakBtn.classList.remove("speaking");
  ttsIndicator.style.display = "none";
}

speakBtn.addEventListener("click", () => {
  if (lastAssistantText) {
    speak(lastAssistantText);
  }
});

stopSpeakBtn.addEventListener("click", stopSpeaking);
ttsStopBtn.addEventListener("click", stopSpeaking);

// ============ VOICE INPUT (STT) ============

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn("[Wave Sidekick] Web Speech API not available");
    micBtn.disabled = true;
    micBtn.title = "Voice input not available in this browser";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = voiceLang;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isRecording = true;
    finalTranscript = "";
    micBtn.classList.add("recording");
    micIcon.style.display = "none";
    micStopIcon.style.display = "block";
    voiceOverlay.style.display = "flex";
    voiceHint.style.display = "block";
    voiceStatus.textContent = "Listening…";
    voiceInterim.textContent = "";
    document.querySelector(".input-wrapper").classList.add("recording");
    resetSilenceTimer();

    // Stop TTS if recording starts (don't talk over yourself)
    if (isSpeaking) stopSpeaking();
  };

  recognition.onresult = (event) => {
    let interim = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interim += transcript;
      }
    }

    const displayText = (finalTranscript + interim).trim();
    voiceInterim.textContent = displayText;
    chatInput.value = displayText;
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
    resetSilenceTimer();
  };

  recognition.onerror = (event) => {
    console.warn("[Wave Sidekick] Speech recognition error:", event.error);

    if (event.error === "no-speech") {
      voiceStatus.textContent = "No speech detected…";
    } else if (event.error === "not-allowed") {
      voiceStatus.textContent = "Microphone access denied";
      stopRecording();
      addMessage("assistant", "⚠️ Microphone access denied. Click the mic button again and allow microphone access when Chrome prompts you.");
    } else if (event.error === "network") {
      voiceStatus.textContent = "Network error";
      stopRecording();
    } else {
      voiceStatus.textContent = "Error: " + event.error;
    }
  };

  recognition.onend = () => {
    const wasRecording = isRecording;
    isRecording = false;

    micBtn.classList.remove("recording");
    micIcon.style.display = "block";
    micStopIcon.style.display = "none";
    voiceOverlay.style.display = "none";
    voiceHint.style.display = "none";
    document.querySelector(".input-wrapper").classList.remove("recording");

    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }

    if (wasRecording && finalTranscript.trim().length > 0) {
      chatInput.value = finalTranscript.trim();
      if (voiceAutoSend) {
        sendMessage();
      } else {
        chatInput.focus();
      }
    }
  };
}

function resetSilenceTimer() {
  if (silenceTimer) clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    if (isRecording && recognition) {
      voiceStatus.textContent = "Stopping…";
      try { recognition.stop(); } catch (e) { console.warn(e); }
    }
  }, silenceTimeout);
}

function startRecording() {
  if (!recognition || isRecording) return;
  recognition.lang = voiceLang;
  try {
    recognition.start();
  } catch (e) {
    console.warn("[Wave Sidekick] Recognition start error:", e);
    try {
      recognition.stop();
      setTimeout(() => recognition.start(), 200);
    } catch (e2) {
      addMessage("assistant", "⚠️ Could not start voice input. Try again or check microphone permissions.");
    }
  }
}

function stopRecording() {
  if (!recognition || !isRecording) return;
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  try { recognition.stop(); } catch (e) { isRecording = false; }
}

micBtn.addEventListener("click", () => {
  if (isRecording) stopRecording();
  else startRecording();
});

// ============ CONFIG ============

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["waveConfig"], (result) => {
      resolve(result.waveConfig || {});
    });
  });
}

function setConfig(updates) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["waveConfig"], (result) => {
      const current = result.waveConfig || {};
      chrome.storage.local.set({ waveConfig: { ...current, ...updates } }, resolve);
    });
  });
}

// ============ PANEL SWITCHING ============

function showAuthGate() {
  authGate.style.display = "flex"; mainPanel.style.display = "none"; settingsPanel.style.display = "none";
}
function showMainPanel() {
  authGate.style.display = "none"; mainPanel.style.display = "flex"; settingsPanel.style.display = "none";
}
function showSettings() {
  authGate.style.display = "none"; mainPanel.style.display = "none"; settingsPanel.style.display = "flex";
  loadSettings();
}

// ============ AUTH ============

document.getElementById("connect-btn").addEventListener("click", async () => {
  const token = document.getElementById("auth-token").value.trim();
  const wsId = document.getElementById("workspace-id").value.trim() || "wave-default";
  const errEl = document.getElementById("auth-error");

  if (!token) {
    errEl.textContent = "Please enter your Wave OS auth token.";
    errEl.style.display = "block";
    return;
  }

  try {
    await setConfig({ authToken: token, workspaceId: wsId });
    errEl.style.display = "none";
    showMainPanel();
    addMessage("assistant", "Connected to Wave OS! I'm ready to help. What can I do for you? Try the mic to talk, or tap the speaker icon to hear my responses!");
    fetchCredits();
    chrome.runtime.sendMessage({ type: "START_HEARTBEAT" });
  } catch (e) {
    errEl.textContent = "Failed to connect: " + e.message;
    errEl.style.display = "block";
  }
});

document.getElementById("open-oswave").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://oswave.io" });
});

// ============ SETTINGS ============

function loadSettings() {
  getConfig().then((config) => {
    document.getElementById("settings-token").value = config.authToken || "";
    document.getElementById("settings-workspace").value = config.workspaceId || "wave-default";
    document.getElementById("settings-orb").checked = config.orbEnabled !== false;
    document.getElementById("settings-voice-auto-send").checked = config.voiceAutoSend !== false;
    document.getElementById("settings-voice-lang").value = config.voiceLang || "en-US";
    document.getElementById("settings-tts-auto").checked = config.ttsAuto === true;
    document.getElementById("settings-tts-rate").value = config.ttsRate || 1.0;
    document.getElementById("settings-tts-pitch").value = config.ttsPitch || 1.0;
    document.getElementById("rate-value").textContent = (config.ttsRate || 1.0).toFixed(1) + "x";
    document.getElementById("pitch-value").textContent = (config.ttsPitch || 1.0).toFixed(1);

    // Refresh voices if needed
    loadVoices();
    const voiceSelect = document.getElementById("settings-tts-voice");
    if (config.ttsVoiceURI) voiceSelect.value = config.ttsVoiceURI;
  });
}

document.getElementById("settings-back").addEventListener("click", () => showMainPanel());
document.getElementById("settings-btn").addEventListener("click", () => showSettings());

document.getElementById("update-token").addEventListener("click", async () => {
  const token = document.getElementById("settings-token").value.trim();
  const wsId = document.getElementById("settings-workspace").value.trim() || "wave-default";
  await setConfig({ authToken: token, workspaceId: wsId });
  fetchCredits();
  showMainPanel();
});

document.getElementById("settings-orb").addEventListener("change", async (e) => {
  await setConfig({ orbEnabled: e.target.checked });
  chrome.runtime.sendMessage({ type: "TOGGLE_ORB" });
});

// STT settings
document.getElementById("settings-voice-auto-send").addEventListener("change", async (e) => {
  voiceAutoSend = e.target.checked;
  await setConfig({ voiceAutoSend: e.target.checked });
});

document.getElementById("settings-voice-lang").addEventListener("change", async (e) => {
  voiceLang = e.target.value;
  await setConfig({ voiceLang: e.target.value });
  if (recognition) recognition.lang = voiceLang;
});

// TTS settings
document.getElementById("settings-tts-auto").addEventListener("change", async (e) => {
  ttsAutoRead = e.target.checked;
  await setConfig({ ttsAuto: e.target.checked });
});

document.getElementById("settings-tts-voice").addEventListener("change", async (e) => {
  ttsVoiceURI = e.target.value;
  await setConfig({ ttsVoiceURI: e.target.value });
});

document.getElementById("settings-tts-rate").addEventListener("input", async (e) => {
  ttsRate = parseFloat(e.target.value);
  document.getElementById("rate-value").textContent = ttsRate.toFixed(1) + "x";
  await setConfig({ ttsRate: ttsRate });
});

document.getElementById("settings-tts-pitch").addEventListener("input", async (e) => {
  ttsPitch = parseFloat(e.target.value);
  document.getElementById("pitch-value").textContent = ttsPitch.toFixed(1);
  await setConfig({ ttsPitch: ttsPitch });
});

document.getElementById("tts-test").addEventListener("click", () => {
  speak("Hey! I'm your Wave Assistant. This is a test of my text-to-speech voice. I can read my responses aloud for you.");
});

document.getElementById("disconnect-btn").addEventListener("click", async () => {
  stopSyncPolling();
  stopSpeaking();
  chrome.runtime.sendMessage({ type: "STOP_HEARTBEAT" });
  stopSpeaking();
  await setConfig({ authToken: null });
  showAuthGate();
});

// ============ PAGE CONTEXT ============

document.getElementById("context-btn").addEventListener("click", async () => {
  chrome.runtime.sendMessage({ type: "GET_PAGE_CONTEXT" }, (response) => {
    if (response && response.ok) {
      pageContext = response.context;
      showContextBanner();
    }
  });
});

function showContextBanner() {
  if (!pageContext) return;
  document.getElementById("context-title").textContent = pageContext.title || "Untitled";
  document.getElementById("context-url").textContent = pageContext.url || "";
  contextBanner.style.display = "flex";
}

document.getElementById("context-clear").addEventListener("click", () => {
  pageContext = null;
  contextBanner.style.display = "none";
});

// ============ QUICK ACTIONS ============

document.querySelectorAll(".quick-action").forEach((btn) => {
  btn.addEventListener("click", () => handleQuickAction(btn.dataset.action));
});

async function handleQuickAction(action) {
  if (action === "briefing") {
    addMessage("user", "Give me my morning briefing");
    await callWaveFunction("waveChiefOfStaff", { action: "morningBriefing" });
  } else if (action === "triage") {
    addMessage("user", "Run triage check");
    await callWaveFunction("waveChiefOfStaff", { action: "triage", proactivity_level: "medium" });
  } else if (action === "followups") {
    addMessage("user", "Show my follow-ups");
    await callWaveFunction("waveChiefOfStaff", { action: "followUpScan" });
  } else if (action === "memory") {
    addMessage("user", "Show my saved memories");
    await callWaveFunction("waveChat", { action: "listMemory" });
  }
}

// ============ CHAT ============

chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener("click", sendMessage);


// ============ CONVERSATION SYNC ============

async function initConversation() {
  const config = await getConfig();
  if (!config || !config.authToken) return;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "API_CALL",
      payload: {
        function: "waveChatSync",
        body: { action: "getConversation", workspace_id: config.workspaceId || "wave-default" }
      }
    });
    if (response.ok && response.data && response.data.conversation_id) {
      conversationId = response.data.conversation_id;
      const messages = response.data.messages || [];
      messagesEl.innerHTML = "";
      knownMessageIds.clear();
      for (const msg of messages) {
        const msgKey = msg.id || (msg.created_date + msg.content);
        if (!knownMessageIds.has(msgKey)) {
          knownMessageIds.add(msgKey);
          addMessage(msg.message_type === "user" ? "user" : "assistant", msg.content);
        }
      }
      if (messages.length > 0) {
        lastSyncTime = messages[messages.length - 1].created_date;
      } else {
        lastSyncTime = new Date().toISOString();
      }
      startSyncPolling();
    }
  } catch (e) {
    console.warn("[Wave Sidekick] Failed to init conversation:", e);
  }
}

function startSyncPolling() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(pollForMessages, 3000);
}

function stopSyncPolling() {
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
}

async function pollForMessages() {
  if (isSyncing || !conversationId || isTyping) return;
  isSyncing = true;
  try {
    const config = await getConfig();
    const response = await chrome.runtime.sendMessage({
      type: "API_CALL",
      payload: {
        function: "waveChatSync",
        body: {
          action: "syncMessages",
          conversation_id: conversationId,
          since: lastSyncTime,
          workspace_id: config.workspaceId || "wave-default"
        }
      }
    });
    if (response.ok && response.data && response.data.messages) {
      for (const msg of response.data.messages) {
        const msgKey = msg.id || (msg.created_date + msg.content);
        if (!knownMessageIds.has(msgKey)) {
          knownMessageIds.add(msgKey);
          addMessage(msg.message_type === "user" ? "user" : "assistant", msg.content);
          if (msg.message_type === "assistant") {
            maybeSpeak(msg.content);
          }
        }
      }
      if (response.data.server_time) {
        lastSyncTime = response.data.server_time;
      }
    }
  } catch (e) {
    // Silent fail — polling will retry
  } finally {
    isSyncing = false;
  }
}

function generateMessageId() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return "msg-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9);
}

// ============ END CONVERSATION SYNC ============

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isTyping) return;

  if (isRecording) stopRecording();

  // Generate unique ID for dedup
  const clientMessageId = generateMessageId();
  const config = await getConfig();
  const wsId = config.workspaceId || "wave-default";

  // Check for duplicate response (safety net)
  try {
    const dupRes = await chrome.runtime.sendMessage({
      type: "API_CALL",
      payload: {
        function: "waveChatSync",
        body: { action: "checkDuplicate", client_message_id: clientMessageId, workspace_id: wsId }
      }
    });
    if (dupRes.ok && dupRes.data && dupRes.data.hasResponse) {
      addMessage("user", text);
      chatInput.value = "";
      chatInput.style.height = "auto";
      addMessage("assistant", dupRes.data.response);
      knownMessageIds.add(clientMessageId);
      return;
    }
  } catch (e) {}

  // Store user message in shared conversation
  addMessage("user", text);
  chatInput.value = "";
  chatInput.style.height = "auto";

  try {
    const storeRes = await chrome.runtime.sendMessage({
      type: "API_CALL",
      payload: {
        function: "waveChatSync",
        body: {
          action: "storeUserMessage",
          message: text,
          conversation_id: conversationId,
          client_message_id: clientMessageId,
          workspace_id: wsId
        }
      }
    });
    if (storeRes.ok && storeRes.data && storeRes.data.conversation_id) {
      conversationId = storeRes.data.conversation_id;
      knownMessageIds.add(storeRes.data.message_id);
    }
  } catch (e) {}

  // Call AI (charges 1 credit)
  await callWaveFunction("waveChat", {
    action: "chat",
    message: text,
    context: pageContext
  });

  // Store AI response in shared conversation
  // The response is captured in the renderResponse function
  // We need to intercept it there, so we'll use a temporary variable
  if (window._lastAiResponse) {
    try {
      await chrome.runtime.sendMessage({
        type: "API_CALL",
        payload: {
          function: "waveChatSync",
          body: {
            action: "storeAssistantMessage",
            response: window._lastAiResponse,
            conversation_id: conversationId,
            client_message_id: clientMessageId,
            workspace_id: wsId
          }
        }
      });
      window._lastAiResponse = null;
    } catch (e) {}
  }
}

// ============ API CALL ============

async function callWaveFunction(funcName, body) {
  if (isTyping) return;
  isTyping = true;
  typingIndicator.style.display = "flex";
  sendBtn.disabled = true;
  micBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "API_CALL",
      payload: { function: funcName, body }
    });

    if (!response.ok) {
      addMessage("assistant", "⚠️ Error: " + response.error);
      return;
    }

    renderResponse(funcName, body.action, response.data);
  } catch (e) {
    addMessage("assistant", "⚠️ Connection error: " + e.message);
  } finally {
    isTyping = false;
    typingIndicator.style.display = "none";
    sendBtn.disabled = false;
    if (recognition) micBtn.disabled = false;
  }
}

// ============ RESPONSE RENDERING ============

function renderResponse(funcName, action, data) {
  if (funcName === "waveChat" && (action === "chat" || !action)) {
    const reply = data.response || data.reply || data.message || JSON.stringify(data);
    // Capture for sync storage
    window._lastAiResponse = reply;
    addMessage("assistant", reply);
    if (data.auto_saved) addMemoryBadge(data.auto_saved);
    maybeSpeak(reply);
    return;
  }

  if (funcName === "waveChat" && action === "listMemory") {
    if (data.ok && data.grouped) renderMemoryList(data);
    else addMessage("assistant", "No memories found.");
    return;
  }

  if (funcName === "waveChat" && action === "saveMemory") {
    const reply = data.ok ? `💾 Saved to ${data.category}` : "Failed to save memory.";
    addMessage("assistant", reply);
    maybeSpeak(reply);
    return;
  }

  if (funcName === "waveChiefOfStaff") {
    renderCoSResponse(action, data);
    return;
  }

  addMessage("assistant", JSON.stringify(data, null, 2));
}

function maybeSpeak(text) {
  // Strip markdown for speaking
  const cleanText = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\n{2,}/g, ". ").replace(/[📊📅⚡✅🧠💾🔴🟡🟢🌊🎉⚠️📄]/g, "").trim();

  if (ttsAutoRead && cleanText.length > 0 && window.speechSynthesis) {
    speak(text);
  }
}

function renderMemoryList(data) {
  const categories = data.categories || [];
  if (categories.length === 0) {
    addMessage("assistant", "No memories saved yet. Select text on any page and right-click → Save to Wave Memory.");
    return;
  }

  let html = `🧠 **Saved Memories** (${data.total} total)\n\n`;
  for (const cat of categories) {
    const items = data.grouped[cat] || [];
    html += `**${cat}** (${items.length})\n`;
    for (const item of items.slice(0, 5)) {
      html += `  • ${item.content.slice(0, 80)}${item.content.length > 80 ? "…" : ""}\n`;
    }
    if (items.length > 5) html += `  • …and ${items.length - 5} more\n`;
    html += "\n";
  }

  addMessage("assistant", html);
}

function renderCoSResponse(action, data) {
  const el = document.createElement("div");
  el.className = "message cos";

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.innerHTML = `<svg width="20" height="20" viewBox="0 0 56 56" fill="none">
    <path d="M28 4C16 4 6 14 6 26c0 8 4 14 10 18 4-6 6-10 12-10s8 4 12 10c6-4 10-10 10-18C50 14 40 4 28 4z" fill="#00e5c0" opacity="0.9"/>
    <circle cx="28" cy="26" r="6" fill="#0a0a14"/>
  </svg>`;

  const content = document.createElement("div");
  content.className = "msg-content";
  content.style.whiteSpace = "pre-wrap";

  let textContent = "";

  if (action === "morningBriefing") {
    content.innerHTML = formatBriefing(data);
    textContent = extractPlainText(data, "briefing");
  } else if (action === "triage") {
    content.innerHTML = formatTriage(data);
    textContent = extractPlainText(data, "triage");
  } else if (action === "followUpScan") {
    content.innerHTML = formatFollowUps(data);
    textContent = extractPlainText(data, "followups");
  } else {
    content.textContent = JSON.stringify(data, null, 2);
    textContent = JSON.stringify(data);
  }

  el.appendChild(avatar);
  el.appendChild(content);
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Store for manual TTS and auto-read
  lastAssistantText = textContent;
  if (ttsAutoRead) maybeSpeak(textContent);
}

function extractPlainText(data, type) {
  let text = "";
  if (type === "briefing") {
    if (data.credits) text += `Credits: ${data.credits.balance} remaining. `;
    if (data.calendar && data.calendar.length > 0) text += `You have ${data.calendar.length} events today. `;
    if (data.tasks && data.tasks.length > 0) text += `You have ${data.tasks.length} action items. `;
    if (data.notifications && data.notifications.length > 0) text += `${data.notifications.length} unread notifications. `;
    text += "All systems checked. Have a great day!";
  } else if (type === "triage") {
    if (data.items && data.items.length > 0) {
      text += `Triage check found ${data.items.length} items. `;
      for (const item of data.items) {
        text += `${item.severity === "high" ? "High priority" : item.severity === "medium" ? "Medium priority" : "Low priority"}: ${item.title || item.type}. `;
      }
    } else {
      text = "Triage check complete. All systems nominal. No urgent items detected.";
    }
  } else if (type === "followups") {
    if (data.overdue?.length) text += `${data.overdue.length} overdue follow-ups. `;
    if (data.due_today?.length) text += `${data.due_today.length} due today. `;
    if (data.upcoming?.length) text += `${data.upcoming.length} upcoming. `;
    if (!text) text = "No follow-ups pending. You're all caught up!";
  }
  return text.trim() || "No data available.";
}

function formatBriefing(data) {
  let html = "📅 **Morning Briefing**\n\n";
  if (data.credits) {
    html += `**Credits:** ${data.credits.balance || "?"} remaining\n`;
    html += data.credits.status === "healthy" ? "✅ Healthy\n\n" : "⚠️ Low — consider topping up\n\n";
  }
  if (data.calendar && data.calendar.length > 0) {
    html += "**Today's Calendar:**\n";
    for (const ev of data.calendar.slice(0, 5)) html += `  • ${ev.title || "Untitled"} — ${ev.start_time || "TBD"}\n`;
    html += "\n";
  } else { html += "**Calendar:** No events today\n\n"; }
  if (data.tasks && data.tasks.length > 0) {
    html += "**Action Items:**\n";
    for (const t of data.tasks.slice(0, 5)) html += `  • ${t.content || t.title || "Task"}\n`;
    html += "\n";
  }
  if (data.notifications && data.notifications.length > 0) html += `**Notifications:** ${data.notifications.length} unread\n\n`;
  html += "_All systems checked. Have a great day!_ 🌊";
  return html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#00e5c0">$1</strong>').replace(/_(.+?)_/g, '<em style="color:#8888a0">$1</em>');
}

function formatTriage(data) {
  let html = "⚡ **Triage Check**\n\n";
  if (data.items && data.items.length > 0) {
    for (const item of data.items) {
      const icon = item.severity === "high" ? "🔴" : item.severity === "medium" ? "🟡" : "🟢";
      html += `${icon} **${item.title || item.type}**\n  ${item.description || ""}\n\n`;
    }
  } else { html += "✅ All systems nominal. No urgent items detected.\n\n"; }
  html += `_Last checked: ${new Date().toLocaleTimeString()}_`;
  return html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#00e5c0">$1</strong>').replace(/_(.+?)_/g, '<em style="color:#8888a0">$1</em>');
}

function formatFollowUps(data) {
  let html = "✅ **Follow-up Scan**\n\n";
  if (data.overdue && data.overdue.length > 0) {
    html += "**Overdue:**\n";
    for (const f of data.overdue) html += `  🔴 ${f.content || f.title || "Task"}\n`;
    html += "\n";
  }
  if (data.due_today && data.due_today.length > 0) {
    html += "**Due Today:**\n";
    for (const f of data.due_today) html += `  🟡 ${f.content || f.title || "Task"}\n`;
    html += "\n";
  }
  if (data.upcoming && data.upcoming.length > 0) {
    html += "**Upcoming:**\n";
    for (const f of data.upcoming.slice(0, 5)) html += `  🟢 ${f.content || f.title || "Task"}\n`;
    html += "\n";
  }
  if (!data.overdue?.length && !data.due_today?.length && !data.upcoming?.length) {
    html += "No follow-ups pending. You're all caught up! 🎉\n\n";
  }
  return html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#00e5c0">$1</strong>');
}

// ============ MESSAGE HELPERS ============

function addMessage(role, text) {
  const el = document.createElement("div");
  el.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  if (role === "user") {
    avatar.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9b4dff" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>`;
  } else {
    avatar.innerHTML = `<svg width="20" height="20" viewBox="0 0 56 56" fill="none"><path d="M28 4C16 4 6 14 6 26c0 8 4 14 10 18 4-6 6-10 12-10s8 4 12 10c6-4 10-10 10-18C50 14 40 4 28 4z" fill="#00e5c0" opacity="0.9"/><circle cx="28" cy="26" r="6" fill="#0a0a14"/></svg>`;
  }

  const content = document.createElement("div");
  content.className = "msg-content";
  content.style.whiteSpace = "pre-wrap";
  content.textContent = text;

  el.appendChild(avatar);
  el.appendChild(content);
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Track last assistant message for manual TTS
  if (role === "assistant" || role === "cos") {
    lastAssistantText = text;
  }
}

function addMemoryBadge(text) {
  const el = document.createElement("div");
  el.style.cssText = "align-self:flex-start;font-size:11px;color:#00e5c0;padding:2px 8px;margin-top:-4px;";
  el.textContent = "💾 " + text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ============ PENDING ACTION ============

async function handlePendingAction(pending) {
  if (!pending) return;

  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_PAGE_CONTEXT" }, (response) => {
      if (response && response.ok) {
        pageContext = response.context;
        showContextBanner();
      }
      resolve();
    });
  });

  if (pending.type === "chat") {
    addMessage("user", pending.text);
    await callWaveFunction("waveChat", {
      action: "chat",
      message: pending.text,
      context: pageContext || pending.pageContext
    });
  } else if (pending.type === "saveMemory") {
    addMessage("user", `Save this: "${pending.text.slice(0, 60)}${pending.text.length > 60 ? "…" : ""}"`);
    await callWaveFunction("waveChat", {
      action: "saveMemory",
      content: pending.text
    });
  }
}

// ============ CREDITS ============

async function fetchCredits() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "API_CALL",
      payload: { function: "waveChiefOfStaff", body: { action: "morningBriefing" } }
    });
    if (response.ok && response.data.credits) {
      creditInfo.textContent = `${response.data.credits.balance || "?"} credits`;
    }
  } catch (e) {
    creditInfo.textContent = "";
  }
}
