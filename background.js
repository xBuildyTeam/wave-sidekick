// Wave Sidekick — Background Service Worker (Chrome MV3)
// Manages side panel state, API calls, context menu, and heartbeat

const WAVE_OS_APP_ID = "6a5abc9bfa61c917463b71cd";
const WAVE_OS_DOMAIN = "https://app.base44.com";
const API_BASE = `${WAVE_OS_DOMAIN}/api/apps/${WAVE_OS_APP_ID}/functions`;

let heartbeatInterval = null;

// --- Side Panel Management ---

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Wave Sidekick] Installed — setting defaults");

  chrome.storage.local.get(["waveConfig"], (result) => {
    if (!result.waveConfig) {
      chrome.storage.local.set({
        waveConfig: {
          authToken: null,
          workspaceId: "wave-default",
          orbEnabled: true,
          theme: "dark"
        }
      });
    }
  });

  // Context menu — right-click → "Ask Wave Assistant"
  chrome.contextMenus.create({
    id: "ask-wave",
    title: "Ask Wave Assistant: \"%s\"",
    contexts: ["selection"]
  });

  // Context menu — right-click → "Save to Wave Memory"
  chrome.contextMenus.create({
    id: "save-wave-memory",
    title: "Save to Wave Memory",
    contexts: ["selection"]
  });

  // Open side panel on action click
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// --- Context Menu Handler ---

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.selectionText) return;

  const config = await getConfig();
  if (!config.authToken) {
    chrome.sidePanel.open({ tabId: tab.id });
    return;
  }

  if (info.menuItemId === "ask-wave") {
    await chrome.storage.local.set({
      pendingAction: {
        type: "chat",
        text: info.selectionText,
        pageContext: { url: tab.url, title: tab.title }
      }
    });
    chrome.sidePanel.open({ tabId: tab.id });
  } else if (info.menuItemId === "save-wave-memory") {
    await chrome.storage.local.set({
      pendingAction: {
        type: "saveMemory",
        text: info.selectionText,
        pageContext: { url: tab.url, title: tab.title }
      }
    });
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// --- Message Handler (from content script & side panel) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "API_CALL") {
    handleApiCall(message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }

  if (message.type === "GET_PAGE_CONTEXT") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "EXTRACT_CONTEXT" }, (response) => {
          sendResponse(response || { ok: false });
        });
      } else {
        sendResponse({ ok: false });
      }
    });
    return true;
  }

  if (message.type === "OPEN_SIDEPANEL") {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
      chrome.sidePanel.open({ tabId }).catch(() => {});
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.sidePanel.open({ tabId: tabs[0].id }).catch(() => {});
        }
      });
    }
    return;
  }

  if (message.type === "TOGGLE_ORB") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_ORB" });
      }
    });
    return;
  }

  if (message.type === "START_HEARTBEAT") {
    startHeartbeat();
    return;
  }

  if (message.type === "STOP_HEARTBEAT") {
    stopHeartbeat();
    return;
  }
});

// --- Heartbeat ---

async function startHeartbeat() {
  if (heartbeatInterval) return; // Already running

  // Send immediately
  await sendHeartbeat();

  // Then every 60 seconds
  heartbeatInterval = setInterval(sendHeartbeat, 60000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  sendHeartbeatOffline();
}

async function sendHeartbeat() {
  try {
    const config = await getConfig();
    if (!config.authToken) return;

    await fetch(`${API_BASE}/extensionStatus`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.authToken}` },
      body: JSON.stringify({
        action: "heartbeat",
        workspace_id: config.workspaceId,
        browser_type: "chrome",
        user_agent: navigator.userAgent
      })
    });
  } catch (e) {
    // Silent fail — heartbeat is non-critical
  }
}

async function sendHeartbeatOffline() {
  try {
    const config = await getConfig();
    if (!config.authToken) return;

    await fetch(`${API_BASE}/extensionStatus`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.authToken}` },
      body: JSON.stringify({
        action: "offline",
        workspace_id: config.workspaceId,
        browser_type: "chrome"
      })
    });
  } catch (e) {
    // Silent fail
  }
}

// --- API Call Handler ---

async function handleApiCall({ function: funcName, body }) {
  const config = await getConfig();
  if (!config.authToken) {
    throw new Error("Not authenticated. Open settings to connect Wave OS.");
  }

  const url = `${API_BASE}/${funcName}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.authToken}`
    },
    body: JSON.stringify({ ...body, workspace_id: config.workspaceId })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API ${response.status}: ${errText}`);
  }

  return await response.json();
}

// --- Config Helper ---

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["waveConfig"], (result) => {
      resolve(result.waveConfig || { authToken: null, workspaceId: "wave-default" });
    });
  });
}

// --- Tab Update — inject orb on new tabs ---

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && !tab.url.startsWith("chrome://")) {
    chrome.storage.local.get(["waveConfig"], (result) => {
      if (result.waveConfig && result.waveConfig.orbEnabled !== false) {
        chrome.tabs.sendMessage(tabId, { type: "SHOW_ORB" }).catch(() => {});
      }
    });
  }
});
