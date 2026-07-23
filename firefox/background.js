// Wave Sidekick — Background Script (Firefox MV2)
// Manages sidebar, API calls, context menu, and heartbeat

// Cross-browser API shim
const api = typeof browser !== "undefined" ? browser : chrome;

const WAVE_OS_APP_ID = "6a5abc9bfa61c917463b71cd";
const WAVE_OS_DOMAIN = "https://app.base44.com";
const API_BASE = `${WAVE_OS_DOMAIN}/api/apps/${WAVE_OS_APP_ID}/functions`;

let heartbeatInterval = null;

// --- Install/Startup ---

api.runtime.onInstalled.addListener(() => {
  console.log("[Wave Sidekick FF] Installed — setting defaults");

  api.storage.local.get(["waveConfig"], (result) => {
    if (!result.waveConfig) {
      api.storage.local.set({
        waveConfig: {
          authToken: null,
          workspaceId: "wave-default",
          orbEnabled: true,
          theme: "dark"
        }
      });
    }
  });

  // Context menus
  api.contextMenus.create({ id: "ask-wave", title: "Ask Wave Assistant: \"%s\"", contexts: ["selection"] });
  api.contextMenus.create({ id: "save-wave-memory", title: "Save to Wave Memory", contexts: ["selection"] });
});

// --- Browser Action Click → Open Sidebar ---

api.browserAction.onClicked.addListener(() => {
  // Firefox: toggle sidebar
  if (api.sidebarAction) {
    api.sidebarAction.open();
  }
});

// --- Context Menu Handler ---

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.selectionText) return;

  const config = await getConfig();
  if (!config.authToken) {
    if (api.sidebarAction) api.sidebarAction.open();
    return;
  }

  if (info.menuItemId === "ask-wave") {
    await api.storage.local.set({
      pendingAction: { type: "chat", text: info.selectionText, pageContext: { url: tab.url, title: tab.title } }
    });
    if (api.sidebarAction) api.sidebarAction.open();
  } else if (info.menuItemId === "save-wave-memory") {
    await api.storage.local.set({
      pendingAction: { type: "saveMemory", text: info.selectionText, pageContext: { url: tab.url, title: tab.title } }
    });
    if (api.sidebarAction) api.sidebarAction.open();
  }
});

// --- Message Handler ---

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "API_CALL") {
    handleApiCall(message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "GET_PAGE_CONTEXT") {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        api.tabs.sendMessage(tabs[0].id, { type: "EXTRACT_CONTEXT" }, (response) => {
          sendResponse(response || { ok: false });
        });
      } else {
        sendResponse({ ok: false });
      }
    });
    return true;
  }

  if (message.type === "OPEN_SIDEPANEL") {
    // Firefox: open sidebar
    if (api.sidebarAction) {
      api.sidebarAction.open();
    }
    return;
  }

  if (message.type === "TOGGLE_ORB") {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) api.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_ORB" });
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

  // Send offline status
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
        browser_type: "firefox",
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
        browser_type: "firefox"
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
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.authToken}` },
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
    api.storage.local.get(["waveConfig"], (result) => {
      resolve(result.waveConfig || { authToken: null, workspaceId: "wave-default" });
    });
  });
}

// --- Tab Update — inject orb ---

api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && !tab.url.startsWith("about:")) {
    api.storage.local.get(["waveConfig"], (result) => {
      if (result.waveConfig && result.waveConfig.orbEnabled !== false) {
        api.tabs.sendMessage(tabId, { type: "SHOW_ORB" }).catch(() => {});
      }
    });
  }
});
