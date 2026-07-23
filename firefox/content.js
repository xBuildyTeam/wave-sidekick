// Wave Sidekick — Content Script (Firefox MV2)
// Injects floating orb on pages, extracts page context

// Cross-browser API shim
const api = typeof browser !== "undefined" ? browser : chrome;

let orb = null;
let orbVisible = true;

function createOrb() {
  if (orb) return;

  orb = document.createElement("div");
  orb.id = "wave-sidekick-orb";
  orb.className = "wave-orb";
  orb.innerHTML = `
    <svg width="32" height="32" viewBox="0 0 56 56" fill="none">
      <defs>
        <linearGradient id="wave-orb-grad-ff" x1="0" y1="0" x2="56" y2="56">
          <stop offset="0%" stop-color="#00e5c0"/>
          <stop offset="100%" stop-color="#9b4dff"/>
        </linearGradient>
      </defs>
      <path d="M28 4C16 4 6 14 6 26c0 8 4 14 10 18 4-6 6-10 12-10s8 4 12 10c6-4 10-10 10-18C50 14 40 4 28 4z"
            fill="url(#wave-orb-grad-ff)" opacity="0.9"/>
      <circle cx="28" cy="26" r="6" fill="#0a0a14"/>
      <circle cx="28" cy="26" r="3" fill="#00e5c0"/>
    </svg>
  `;

  let isDragging = false;
  let startX, startY, hasMoved = false;

  orb.addEventListener("mousedown", (e) => {
    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    orb.style.transition = "none";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;

    const orbRect = orb.getBoundingClientRect();
    orb.style.right = "auto";
    orb.style.bottom = "auto";
    orb.style.left = Math.max(10, Math.min(window.innerWidth - 50, orbRect.left + dx)) + "px";
    orb.style.top = Math.max(10, Math.min(window.innerHeight - 50, orbRect.top + dy)) + "px";
    startX = e.clientX;
    startY = e.clientY;
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      orb.style.transition = "transform 0.2s, opacity 0.2s";
    }
  });

  orb.addEventListener("click", (e) => {
    if (hasMoved) { e.stopPropagation(); e.preventDefault(); return; }
    // Send message to background to open sidebar
    api.runtime.sendMessage({ type: "OPEN_SIDEPANEL" });
  });

  document.body.appendChild(orb);
}

function removeOrb() {
  if (orb) { orb.remove(); orb = null; }
}

function extractPageContext() {
  const context = {
    url: window.location.href,
    title: document.title,
    description: "",
    selectedText: "",
    headings: [],
    meta: {}
  };

  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) context.description = metaDesc.content || "";

  const ogTitle = document.querySelector('meta[property="og:title"]');
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogTitle) context.meta.ogTitle = ogTitle.content;
  if (ogDesc) context.meta.ogDesc = ogDesc.content;

  const selection = window.getSelection();
  if (selection && selection.toString().trim()) {
    context.selectedText = selection.toString().trim().slice(0, 2000);
  }

  const headings = document.querySelectorAll("h1, h2, h3");
  for (let i = 0; i < Math.min(headings.length, 5); i++) {
    context.headings.push(headings[i].textContent.trim().slice(0, 120));
  }

  const host = window.location.hostname;
  if (host.includes("github.com")) context.siteType = "github";
  else if (host.includes("stackoverflow.com")) context.siteType = "stackoverflow";
  else if (host.includes("youtube.com")) context.siteType = "youtube";
  else if (host.includes("oswave.io")) context.siteType = "waveos";

  return context;
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_CONTEXT") {
    sendResponse({ ok: true, context: extractPageContext() });
    return;
  }

  if (message.type === "SHOW_ORB") {
    if (orbVisible) createOrb();
    return;
  }

  if (message.type === "TOGGLE_ORB") {
    orbVisible = !orbVisible;
    if (orbVisible) createOrb();
    else removeOrb();
    return;
  }

  if (message.type === "HIDE_ORB") {
    removeOrb();
    return;
  }
});

api.storage.local.get(["waveConfig"], (result) => {
  if (result.waveConfig && result.waveConfig.orbEnabled !== false) {
    setTimeout(createOrb, 1000);
  }
});

document.addEventListener("selectionchange", () => {
  if (orb) {
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 10) {
      orb.classList.add("wave-orb-active");
    } else {
      orb.classList.remove("wave-orb-active");
    }
  }
});
