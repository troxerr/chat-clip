"use strict";

// The window. Plain DOM, no framework. Everything it knows comes from window.hd
// (the bridge defined in preload.js); it never touches files or processes.
// Text from the recorder or from chat is only ever inserted with textContent.

(function () {
  const PAGES = ["capture", "clips", "settings"];
  let hd = null;
  let snap = null;
  let upd = { status: "disabled" };
  let announcedUpdate = null;
  let licenseRetry = null;
  let clipList = [];
  let clipQuery = "";
  const ui = {};

  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === false || value === null || value === undefined) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return node;
  }
  const $ = (id) => document.getElementById(id);
  const clock = (seconds) => { const s = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); };
  const PHASE_LABEL = { idle: "Not recording", starting: "Starting", buffering: "Buffering", watching: "Watching", exporting: "Saving a highlight", stopping: "Stopping", error: "Problem" };

  // kind "info" is calm news (an update is ready); the default is an error.
  let noticeTimer = null;
  function notify(message, kind, clearAfterMs) {
    const box = $("notice");
    clearTimeout(noticeTimer);
    box.textContent = message || "";
    box.hidden = !message;
    box.classList.toggle("info", kind === "info");
    // A passing note (a highlight was saved) removes itself.
    if (message && clearAfterMs) noticeTimer = setTimeout(() => { if (box.textContent === message) notify(""); }, clearAfterMs);
  }
  async function guarded(fn) {
    notify("");
    try { return await fn(); } catch (error) { notify(String((error && error.message) || error).replace(/^Error invoking remote method '[^']*': (Error: )?/, "")); return undefined; }
  }

  // ---- pages -------------------------------------------------------------

  function buildCapture() {
    const root = $("page-capture");
    ui.status = { badge: el("span", { class: "badge idle", id: "phase" }), msg: el("p", { id: "phase-msg", "aria-live": "polite" }), channel: el("dd"), buffered: el("dd", { id: "buffered-time" }), saved: el("dd") };
    const statusCard = el("div", { class: "card" },
      el("div", { class: "row" }, el("h2", { text: "Status" }), ui.status.badge),
      ui.status.msg,
      el("dl", { class: "stats" },
        el("div", {}, el("dt", { text: "Channel" }), ui.status.channel),
        el("div", {}, el("dt", { text: "Video buffered" }), ui.status.buffered),
        el("div", {}, el("dt", { text: "Highlights this session" }), ui.status.saved)));

    ui.channel = el("input", { type: "text", id: "channel", placeholder: "username or twitch.tv/username", autocomplete: "off", spellcheck: "false", "aria-describedby": "capture-intro" });
    ui.ack = el("input", { type: "checkbox", id: "ack" });
    ui.ackRow = el("label", { class: "check", for: "ack" }, ui.ack, el("span", { text: "I have permission to record this channel, and I will follow Twitch's terms and the streamer's wishes." }));
    ui.startBtn = el("button", { class: "btn primary", type: "submit", text: "Start capture", "aria-describedby": "start-reason" });
    ui.startReason = el("p", { class: "help", id: "start-reason" });
    ui.intro = el("p", { class: "help", id: "capture-intro" });
    ui.banner = el("div", { class: "notice info", id: "license-banner", hidden: true });
    ui.stopBtn = el("button", { class: "btn", type: "button", text: "Stop", onclick: () => guarded(async () => { snap = await hd.stop(); updateCapture(); }) });
    ui.saveBtn = el("button", { class: "btn", type: "button", text: "Save highlight now", title: "Ctrl+S", onclick: () => guarded(() => hd.saveHighlight()) });
    ui.missedBtn = el("button", { class: "btn", type: "button", text: "Mark missed moment", title: "Records this time for review. It does not save a clip.", onclick: () => guarded(async () => { await hd.markMissed(); notify("Marked this moment for review. It does not save a clip.", "info", 6000); }) });
    const form = el("form", { class: "card", novalidate: true, onsubmit: (event) => { event.preventDefault(); onStart(); } },
      el("label", { for: "channel", text: "Twitch channel" }),
      ui.channel,
      ui.intro,
      ui.ackRow,
      el("div", { class: "row", style: false }, ui.startBtn, ui.stopBtn, ui.saveBtn, ui.missedBtn),
      ui.startReason);
    ui.channel.addEventListener("input", () => updateCapture());
    ui.ack.addEventListener("change", () => updateCapture());

    ui.recent = el("ul", { class: "clip-list", "aria-label": "Recent highlights" });
    ui.recentHead = el("h2", { text: "Recent highlights" });
    const sample = el("details", { class: "card sample-session" },
      el("summary", { text: "Try a sample session" }),
      el("p", { class: "help", text: "In this simulation, a burst of unique chatters triggers a vertical export." }),
      el("video", { controls: true, preload: "none", src: "../../site/media/sample-highlight.mp4", "aria-label": "Simulated vertical highlight" }),
      el("button", { class: "btn", type: "button", text: "Save sample MP4", onclick: () => guarded(async () => {
        if (await hd.exportSample()) notify("Sample MP4 saved.", "info", 6000);
      }) }),
      el("p", { class: "help", text: "To check a real export, enter your Twitch channel while it is live, then start capture. Once the status says Watching, choose Save highlight now." }));
    root.replaceChildren(el("h1", { id: "h-capture", text: "Capture" }), ui.banner, form, sample, statusCard, ui.recentHead, ui.recent);
  }

  async function onStart() {
    const input = ui.channel.value.trim();
    if (ui.startBtn.getAttribute("aria-disabled") === "true") { ui.channel.focus(); return; }
    await guarded(async () => {
      snap = await hd.start(input, { acknowledge: ui.ack.checked });
      updateCapture();
    });
  }

  function updateCapture() {
    const c = snap.capture;
    ui.status.badge.className = `badge ${c.phase}`;
    ui.status.badge.textContent = PHASE_LABEL[c.phase] || c.phase;
    const lastProblem = c.lastError && c.phase !== "error" ? ` Last problem: ${c.lastError}` : "";
    const message = c.message + lastProblem;
    if (ui.status.msg.textContent !== message) ui.status.msg.textContent = message;
    ui.status.channel.textContent = c.channel || "—";
    ui.status.buffered.textContent = c.phase === "idle" ? "—" : clock(c.mediaTime);
    ui.status.saved.textContent = String(c.clipsSaved);
    const running = !["idle", "error"].includes(c.phase);
    ui.channel.disabled = running;
    ui.startBtn.hidden = running;
    ui.stopBtn.hidden = !running;
    ui.saveBtn.hidden = !running;
    ui.saveBtn.disabled = c.phase !== "watching";
    ui.missedBtn.hidden = !running;
    ui.missedBtn.disabled = c.phase !== "watching";
    ui.intro.textContent = StartGuide.captureIntro(c.phase);
    ui.intro.hidden = !ui.intro.textContent;
    ui.ackRow.hidden = snap.settings.permissionAcknowledged || running;
    const reason = running ? "" : StartGuide.startBlocker({ license: snap.license, channel: ui.channel.value, ackNeeded: !snap.settings.permissionAcknowledged, ack: ui.ack.checked });
    // aria-disabled keeps the button focusable, so the reason below it can be read.
    ui.startBtn.setAttribute("aria-disabled", reason ? "true" : "false");
    ui.startBtn.classList.toggle("is-disabled", Boolean(reason));
    ui.startReason.textContent = reason && ui.channel.value.trim() ? reason : (reason && !snap.license.valid ? reason : "");
    ui.startReason.hidden = !ui.startReason.textContent;
    const banner = StartGuide.licenseBanner(snap.license);
    ui.banner.hidden = !banner;
    if (banner) {
      ui.banner.className = `notice ${banner.kind === "info" ? "info" : ""}`;
      const kids = [el("span", { text: banner.text })];
      for (const button of StartGuide.bannerButtons(snap.license)) {
        kids.push(document.createTextNode(" "));
        kids.push(el("button", {
          class: button.action === "buy" ? "btn primary" : "btn",
          type: "button",
          text: button.label,
          onclick: () => (button.action === "buy" ? guarded(() => hd.license.buy()) : show("settings"))
        }));
      }
      ui.banner.replaceChildren(...kids);
    }
  }

  function updateRecentClips() {
    renderClipRows(ui.recent, clipList.slice(0, 3), true);
    ui.recentHead.hidden = ui.recent.hidden = clipList.length === 0;
  }

  function thumbButton(clip, direction) {
    const path = direction === "up"
      ? "M2 21h4V9H2v12zm20-11a2 2 0 0 0-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13.2 1 6.6 7.6C6.2 8 6 8.5 6 9v10a2 2 0 0 0 2 2h9a2 2 0 0 0 1.8-1.2l3-7c.1-.2.2-.5.2-.8v-2z"
      : "M22 3h-4v12h4V3zM2 14a2 2 0 0 0 2 2h6.3l-1 4.6v.3c0 .4.2.8.4 1.1l1.1 1L17.4 16c.4-.4.6-.9.6-1.4V5a2 2 0 0 0-2-2H7a2 2 0 0 0-1.8 1.2l-3 7c-.1.2-.2.5-.2.8v2z";
    const label = direction === "up" ? "Good highlight" : "Not a useful highlight";
    const button = el("button", { class: "thumb", type: "button", "aria-label": label, title: label, "aria-pressed": clip.rating === direction ? "true" : "false",
      onclick: () => guarded(async () => { await hd.clips.rate(clip.id, direction); await loadClips(); }) });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", path); svg.append(p); button.append(svg);
    return button;
  }

  function openTrim(clip) {
    const start = el("input", { type: "number", min: "0", step: "0.01", required: true, value: "0" });
    const end = el("input", { type: "number", min: "0.1", step: "0.01", required: true });
    const status = el("p", { role: "status" });
    const save = el("button", { class: "btn primary", type: "submit", text: "Save trimmed copy" });
    const modal = el("dialog", { "aria-labelledby": "trim-title" });
    const close = el("button", { class: "btn", type: "button", text: "Close", onclick: () => modal.close() });
    const form = el("form", { onsubmit: async (event) => {
      event.preventDefault();
      save.disabled = true;
      close.disabled = true;
      status.textContent = "Preparing MP4…";
      try {
        if (await hd.clips.trim(clip.id, start.valueAsNumber, end.valueAsNumber)) {
          modal.close();
          notify("Trimmed MP4 saved.", "info", 6000);
        } else status.textContent = "";
      } catch (error) {
        status.textContent = error.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "");
      } finally {
        save.disabled = false;
        close.disabled = false;
      }
    } }, el("h2", { id: "trim-title", text: "Trim highlight" }),
      el("label", {}, "Start (seconds)", start), el("label", {}, "End (seconds)", end),
      status, el("div", { class: "row" }, save, close));
    modal.append(form);
    modal.addEventListener("close", () => modal.remove(), { once: true });
    modal.addEventListener("cancel", (event) => { if (save.disabled) event.preventDefault(); });
    document.body.append(modal);
    modal.showModal();
  }

  function renderClipRows(list, items, compact) {
    list.replaceChildren(...items.map((clip) => el("li", { class: "clip" },
      el("div", {},
        el("div", { class: "clip-title", text: clip.reason || "Highlight" }),
        el("div", { class: "clip-meta" }, clip.channel && el("span", { text: clip.channel }), el("span", { text: when(clip.createdAt) }),
          !clip.available && el("span", { class: "badge error", text: "File missing" }))),
      el("div", { class: "clip-actions" },
        el("button", { class: "btn small", type: "button", text: "Open", disabled: !clip.available, onclick: () => guarded(() => hd.clips.open(clip.id)) }),
        el("button", { class: "btn small", type: "button", text: "Show in folder", disabled: !clip.available, onclick: () => guarded(() => hd.clips.reveal(clip.id)) }),
        !compact && el("button", { class: "btn small", type: "button", text: "Trim", disabled: !clip.available, onclick: () => openTrim(clip) }),
        !compact && thumbButton(clip, "up"), !compact && thumbButton(clip, "down")))));
  }

  function buildClips() {
    ui.search = el("input", { type: "search", id: "clip-search", placeholder: "Search by channel or reason", "aria-label": "Search clips", oninput: (e) => { clipQuery = e.target.value; updateClips(); } });
    ui.clipList = el("ul", { class: "clip-list", "aria-label": "Clips" });
    ui.clipEmpty = el("div", { class: "card empty" });
    $("page-clips").replaceChildren(el("h1", { id: "h-clips", text: "Clips" }),
      el("div", { class: "toolbar" }, ui.search, el("button", { class: "btn", type: "button", text: "Open clip folder", onclick: () => guarded(() => hd.openClipFolder()) })),
      ui.clipList, ui.clipEmpty);
  }

  function updateClips() {
    const q = clipQuery.trim().toLowerCase();
    const items = q ? clipList.filter((c) => `${c.channel} ${c.reason}`.toLowerCase().includes(q)) : clipList;
    renderClipRows(ui.clipList, items, false);
    ui.clipList.hidden = items.length === 0;
    ui.clipEmpty.hidden = items.length > 0;
    if (items.length === 0) {
      if (clipList.length === 0) {
        ui.clipEmpty.replaceChildren(el("h2", { text: "No clips yet" }), el("p", { class: "muted", text: "Start a capture. Highlights appear here as soon as they are saved." }),
          el("button", { class: "btn primary", type: "button", text: "Go to Capture", onclick: () => show("capture") }));
      } else {
        ui.clipEmpty.replaceChildren(el("h2", { text: "No clips match your search" }),
          el("button", { class: "btn", type: "button", text: "Clear search", onclick: () => { ui.search.value = ""; clipQuery = ""; updateClips(); } }));
      }
    }
  }

  function buildSettings() {
    ui.licenseCard = el("div", { class: "card", id: "license-card" });
    ui.launch = el("input", { type: "checkbox", id: "launch", onchange: () => guarded(async () => { await hd.settings.set({ launchAtLogin: ui.launch.checked }); await refresh(); }) });
    ui.layout = el("select", { id: "export-layout", onchange: () => guarded(async () => {
      try { await hd.settings.set({ exportLayout: ui.layout.value }); } finally { await refresh(); }
    }) },
      el("option", { value: "blur", text: "Full frame over blur" }),
      el("option", { value: "split", text: "Gameplay and facecam" }));
    ui.folder = el("dd");
    ui.about = el("dl", { class: "kv" });
    ui.updText = el("p", { id: "update-status", role: "status" });
    ui.updBtn = el("button", { class: "btn", type: "button", id: "update-btn", onclick: () => guarded(async () => {
      if (upd.status === "ready") {
        const phase = snap && snap.capture && snap.capture.phase;
        if (phase && phase !== "idle" && !window.confirm("ClipSpike is capturing right now. Restarting will stop the capture. Restart and update anyway?")) return;
        await hd.update.install();
      } else await hd.update.check();
    }) });
    $("page-settings").replaceChildren(el("h1", { id: "h-settings", text: "Settings" }), ui.licenseCard,
      el("div", { class: "card" }, el("h2", { text: "General" }),
        el("label", { class: "check", for: "launch" }, ui.launch, el("span", { text: "Start ClipSpike when I sign in to Windows" })),
        el("dl", { class: "kv" }, el("dt", { text: "Clip folder" }), ui.folder),
        el("div", { class: "row", style: false }, el("button", { class: "btn", type: "button", text: "Open clip folder", onclick: () => guarded(() => hd.openClipFolder()) }))),
      el("div", { class: "card" }, el("h2", { text: "Vertical export" }),
        el("label", { for: "export-layout", text: "Layout" }), ui.layout,
        el("p", { class: "help", text: "The gameplay and facecam preset uses your configured camera crop, or the lower-left corner by default. Layout changes apply to the next capture." })),
      el("div", { class: "card", id: "update-card" }, el("h2", { text: "Updates" }), ui.updText, el("div", { class: "row", style: false }, ui.updBtn)),
      el("div", { class: "card" }, el("h2", { text: "About" }), ui.about));
  }

  // When an update finishes downloading, say so once and mark Settings, so people need not look for it.
  function announceUpdate() {
    const ready = upd.status === "ready";
    const settingsNav = document.querySelector('.nav[data-page="settings"]');
    settingsNav.classList.toggle("has-update", ready);
    if (ready) settingsNav.setAttribute("title", `Version ${upd.version} is ready to install`); else settingsNav.removeAttribute("title");
    if (ready && announcedUpdate !== upd.version) {
      announcedUpdate = upd.version;
      if (!$("page-settings").hidden) return;
      notify(`Version ${upd.version} is ready. Open Settings to restart and update.`, "info");
    }
  }

  // Updates are checked at launch and download in the background; this card shows where that stands
  // and lets people check now or restart into a downloaded version.
  function updateUpdates() {
    const { status, version, percent, error } = upd;
    const label = {
      disabled: "Automatic updates are not available in this build.",
      idle: "ClipSpike checks for updates when it starts.",
      checking: "Checking for updates…",
      downloading: `Downloading version ${version}${Number.isFinite(percent) ? ` (${percent}%)` : ""}…`,
      ready: `Version ${version} is ready. Restart ClipSpike to finish updating.`,
      "up-to-date": `You have the latest version${snap && snap.version ? ` (${snap.version})` : ""}.`,
      error: `Could not check for updates${error ? `: ${error}` : "."}`
    }[status] || "";
    ui.updText.textContent = label;
    ui.updBtn.hidden = status === "disabled";
    ui.updBtn.disabled = status === "checking" || status === "downloading";
    ui.updBtn.classList.toggle("primary", status === "ready");
    announceUpdate();
    ui.updBtn.textContent = status === "ready" ? "Restart to update" : status === "error" ? "Try again" : "Check for updates";
  }

  function updateSettings() {
    const lic = snap.license;
    const keyInput = el("input", { type: "text", id: "license-key", placeholder: "Paste your license key", autocomplete: "off", spellcheck: "false", "aria-label": "License key" });
    const badge = el("span", { class: `badge ${lic.mode === "expired" ? "expired" : lic.valid ? "ok" : "error"}`, text: { development: "Development build", trial: "Trial", licensed: "Licensed", "licensed-unverified": "Licensed", expired: "Expired" }[lic.mode] || lic.mode });
    const rows = [el("div", { class: "row" }, el("h2", { text: "License" }), badge), el("p", { text: lic.message })];
    if (lic.required) {
      if (lic.hasKey) {
        rows.push(el("div", { class: "row" },
          el("button", { class: "btn", type: "button", text: "Check now", onclick: () => guarded(async () => { await hd.license.validate(); await refresh(); }) }),
          el("button", { class: "btn danger", type: "button", text: "Remove from this PC", onclick: () => { if (!window.confirm("Remove the license from this PC? You can activate it again later with your key.")) return; guarded(async () => { await hd.license.deactivate(); await refresh(); }); } })));
      } else {
        rows.push(el("label", { for: "license-key", text: "License key" }), keyInput,
          el("p", { class: "muted", text: "The license key arrives by email. Paste it here." }),
          el("div", { class: "row", style: false },
            el("button", { class: "btn primary", type: "button", text: "Activate", onclick: () => guarded(async () => { await hd.license.activate(keyInput.value); keyInput.value = ""; await refresh(); }) }),
            lic.checkoutUrl && el("button", { class: "btn", type: "button", text: StartGuide.buyLabel(lic), onclick: () => guarded(() => hd.license.buy()) })));
      }
    }
    ui.licenseCard.replaceChildren(...rows);
    // The key is saved but could not be read just now: look again shortly instead of showing a trial.
    if (lic.keyUnreadable && !licenseRetry) licenseRetry = setTimeout(() => { licenseRetry = null; refresh().catch(() => {}); }, 20000);
    ui.layout.value = snap.settings.exportLayout || "blur";
    ui.launch.checked = snap.settings.launchAtLogin;
    ui.folder.textContent = snap.settings.outputFolder || "";
    const v = snap.versions || {};
    ui.about.replaceChildren(
      ...[["Version", snap.version], ["Electron", v.electron], ["Node", v.node]].filter(([, x]) => x).flatMap(([k, x]) => [el("dt", { text: k }), el("dd", { text: x })]));
    const licenseShort = { trial: `Trial · ${lic.daysLeft}d`, licensed: "Licensed", "licensed-unverified": "Licensed", expired: "Trial ended", development: "Development" }[lic.mode];
    $("sidebar-foot").textContent = [snap.version ? `v${snap.version}` : "", lic.required ? licenseShort : ""].filter(Boolean).join(" · ");
  }

  // ---- shell -------------------------------------------------------------

  function show(page) {
    for (const name of PAGES) {
      $(`page-${name}`).hidden = name !== page;
      const button = document.querySelector(`.nav[data-page="${name}"]`);
      if (name === page) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    }
    if (page === "clips") loadClips();
    document.title = `${page[0].toUpperCase()}${page.slice(1)} — ClipSpike`;
  }

  async function refresh() {
    snap = await hd.getState();
    upd = (await hd.update.state()) || upd;
    updateCapture();
    updateSettings();
    updateUpdates();
  }

  async function loadClips() {
    clipList = await hd.clips.list();
    updateRecentClips();
    updateClips();
  }

  async function boot() {
    if (!window.hd && new URLSearchParams(location.search).has("stub")) {
      await new Promise((resolve, reject) => { const s = document.createElement("script"); s.src = "../dev/stub-bridge.js"; s.onload = resolve; s.onerror = reject; document.head.append(s); });
    }
    hd = window.hd;
    if (!hd) { document.body.textContent = "The app bridge is missing. Please reinstall ClipSpike."; return; }
    buildCapture(); buildClips(); buildSettings();
    for (const button of document.querySelectorAll(".nav")) button.addEventListener("click", () => show(button.dataset.page));
    hd.on("capture", (capture) => { if (snap) { snap = { ...snap, capture }; updateCapture(); } });
    hd.on("clips", () => loadClips());
    hd.on("navigate", (page) => { if (PAGES.includes(page)) show(page); });
    hd.on("notice", (message) => (message && typeof message === "object" ? notify(message.message, message.kind, message.clearAfterMs) : notify(message)));
    hd.on("update", (state) => { upd = state; updateUpdates(); });
    await refresh();
    await loadClips();
    show(new URLSearchParams(location.search).get("page") || "capture");
    window.__hdReady = true;
  }
  boot().catch((error) => { document.body.textContent = `ClipSpike could not start: ${error.message}`; });
})();
