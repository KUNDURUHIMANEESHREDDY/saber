// OVERLORD client — server-driven. All pipeline state comes from /api/stream.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const stamp = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const esc = (s) => String(s).replace(/&/g, "&").replace(/</g, "<");
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}

/* ---------- logs ---------- */
let logs = [], filter = "all";
function addLocal(type, actor, message, time) { logs.push({ time: time || stamp(), type, actor, message }); renderLogs(); }
function renderLogs() {
  const q = $("#logSearch").value.toLowerCase();
  const vis = logs.filter((x) => (filter === "all" || x.type === filter) && (!q || (x.actor + " " + x.message).toLowerCase().includes(q)));
  $("#logs").innerHTML = vis.slice(-40).reverse().map((x) =>
    `<div class="log"><time>${x.time}</time><div class="body"><span class="badge ${x.type}">${esc(x.actor)}</span><p>${esc(x.message)}</p></div></div>`).join("") ||
    '<div style="padding:22px;color:#9ca3af;font-size:10px">No matching events.</div>';
  $("#fullLogs").innerHTML = logs.slice().reverse().map((x) =>
    `<div class="full-log"><time>${x.time}</time><strong>${esc(x.actor)}</strong><span>${esc(x.message)}</span></div>`).join("");
}
$$(".log-tabs button").forEach((b) => (b.onclick = () => {
  $$(".log-tabs button").forEach((x) => x.classList.remove("active"));
  b.classList.add("active"); filter = b.dataset.filter; renderLogs();
}));
$("#logSearch").oninput = renderLogs;
$("#clearLogs").onclick = async () => { await api("DELETE", "/api/logs").catch(() => {}); logs = []; renderLogs(); };
$("#expandLogs").onclick = () => { renderLogs(); $("#overlay").classList.add("open"); };
$("#overlay").onclick = (e) => { if (e.target.id === "overlay") $("#overlay").classList.remove("open"); };
$("#closeModal").onclick = () => $("#overlay").classList.remove("open");
$("#exportBtn").onclick = async () => {
  const d = await api("GET", "/api/logs?limit=1000").catch(() => ({ logs }));
  const blob = new Blob([JSON.stringify(d.logs || d, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "overlord-event-log.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

/* ---------- sessions ---------- */
$$(".session").forEach((s) => (s.onclick = () => { $$(".session").forEach((x) => x.classList.remove("active")); s.classList.add("active"); }));
$("#sessionSearch").oninput = (e) => {
  const q = e.target.value.toLowerCase();
  $$(".session").forEach((s) => (s.style.display = s.innerText.toLowerCase().includes(q) ? "block" : "none"));
};
$("#newSession").onclick = () => {
  const ns = $("#noSessions"); if (ns) ns.remove();
  const s = document.createElement("button");
  s.className = "session active";
  s.innerHTML = '<div class="row"><strong>New agent session</strong><time>Now</time></div><p>Ready for a new task</p>';
  s.onclick = () => { $$(".session").forEach((x) => x.classList.remove("active")); s.classList.add("active"); };
  $("#sessionList").prepend(s);
};

/* ---------- pipeline rendering (driven by server events) ---------- */
const ROWS = [
  { match: ["research"], bar: "#p1", pct: "#pct1" },
  { match: ["code", "exec"], bar: "#p2", pct: "#pct2" },
  { match: ["review"], bar: "#p3", pct: "#pct3" },
];
const CAPS = ["research", "code", "exec", "review"];
function capOf(agent) {
  if (agent.startsWith("spawn-")) return agent.split("-")[1] || "";
  return { researcher: "research", coder: "code", tools: "exec", critic: "review" }[agent] || "";
}
function rowFor(agent) {
  const c = capOf(agent);
  const i = ROWS.findIndex((r) => r.match.includes(c));
  return i < 0 ? null : { i, ...ROWS[i] };
}
const timers = {};
function trace(line) { $("#trace").innerHTML += `<br>${stamp()} · ${esc(line)}`; }
function setState(i, cls, label) {
  const s = $$(".assignment .state")[i];
  if (s) { s.innerHTML = "<span class='dot'></span>" + esc(label); s.className = "state " + cls; }
}
function setBar(i, p) { $(ROWS[i].bar).style.width = p + "%"; $(ROWS[i].pct).textContent = p + "%"; }
function setDesc(i, t) { $$(".progress-desc")[i].textContent = t; }
function progressStatus() {
  const done = $$(".assignment .state.done").length;
  $("#progressStatus").textContent = done + " of 3 complete";
}
function resetRun(title) {
  ROWS.forEach((_, i) => { setBar(i, 0); setState(i, "", "Queued"); });
  setDesc(0, "Starting..."); setDesc(1, "Waiting for source data..."); setDesc(2, "Waiting for scraped data...");
  $("#progressStatus").textContent = "0 of 3 complete";
  document.querySelector(".workspace-head h1").textContent = title.slice(0, 48);
}
function startBar(i) {
  stopBar(i);
  let p = parseInt($(ROWS[i].bar).style.width) || 0;
  timers[i] = setInterval(() => { p = Math.min(92, p + 2); setBar(i, p); }, 120);
}
function stopBar(i, done) {
  clearInterval(timers[i]);
  if (done) setBar(i, 100);
}
function userMsg(text) {
  $(".conversation").insertAdjacentHTML("beforeend",
    `<div class="user-message"><div class="message-meta"><span>You</span><time>${stamp()}</time></div><p></p></div>`);
  $(".conversation").lastElementChild.querySelector("p").textContent = text;
}
function resultCard(lines) {
  $(".conversation").insertAdjacentHTML("beforeend",
    `<div class="agent-intro"><div class="agent-mark">A</div><div><strong>OVERLORD</strong><span>Supervisor · Final response.</span></div></div><section class="section"><div class="section-head"><strong>Result</strong><span>${stamp()}</span></div><div class="plan"><ol>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol></div></section>`);
}
function approvalBox(runId, text) {
  const id = "appr-" + runId;
  $(".conversation").insertAdjacentHTML("beforeend",
    `<section class="section" id="${id}"><div class="section-head"><strong>Approval needed</strong><span>human gate</span></div><div class="plan"><p style="margin:0 0 10px">${esc(text)}</p><button class="ghost" data-ok="1">Approve</button> <button class="ghost" data-ok="0">Reject</button></div></section>`);
  $("#" + CSS.escape(id)).querySelectorAll("button").forEach((b) => (b.onclick = () => {
    api("POST", `/api/runs/${runId}/approve`, { ok: b.dataset.ok === "1" }).catch(() => {});
    $("#" + CSS.escape(id)).remove();
  }));
}

function onEvent(e) {
  if (e.type !== "config") logs.push({ time: e.ts.slice(11, 19), type: tagOf(e), actor: e.source.toUpperCase(), message: labelOf(e) });
  renderLogs();
  const r = e.runId ? rowFor(e.target === "supervisor" ? e.source : e.target) : null;
  switch (e.type) {
    case "user_message": userMsg(e.payload); resetRun(e.payload); break;
    case "thinking": trace(e.payload); break;
    case "policy": trace("Guardrails: " + e.payload); break;
    case "task_assign":
      if (r) { setState(r.i, "running", "Running"); setDesc(r.i, e.payload + "..."); startBar(r.i); }
      trace(`Assigned to ${e.target}.`); break;
    case "task_result":
      if (r) { stopBar(r.i, true); setState(r.i, "done", "Done"); setDesc(r.i, "Complete."); progressStatus(); }
      trace(`${e.source} finished.`); break;
    case "agent_spawned":
      try { const s = JSON.parse(e.payload); trace(`Capability miss — spawned ${s.id} (${s.cap}).`); } catch {} break;
    case "agent_retired": trace(`${e.payload.split(" ")[0]} retired.`); break;
    case "approval_needed": approvalBox(e.runId, e.payload); trace("Waiting for human approval."); break;
    case "approval_denied": trace("Human rejected the final answer."); break;
    case "approval_granted": trace("Human approved."); break;
    case "final_answer":
      resultCard([e.payload]);
      trace("Run complete · final response delivered.");
      $("#progressStatus").textContent = "3 of 3 complete";
      break;
  }
}
function tagOf(e) {
  if (e.source === "user") return "user";
  if (e.source === "system") return "system";
  return "agent";
}
function labelOf(e) {
  const m = { user_message: "Request received.", thinking: e.payload.slice(0, 90), policy: "Guardrails: " + e.payload.slice(0, 80),
    task_assign: `Assigned → ${e.target}.`, task_result: e.payload.slice(0, 90), agent_spawned: e.payload.slice(0, 80),
    agent_retired: e.payload.slice(0, 80), approval_needed: "Approval requested.", approval_granted: "Approved by human.",
    approval_denied: "Rejected by human.", final_answer: "Final response delivered.", config: e.payload.slice(0, 80) };
  return m[e.type] || e.payload.slice(0, 90);
}

/* ---------- composer & modern model picker ---------- */
function send() {
  const box = $("#message");
  const text = box.value.trim();
  if (!text) return;
  box.value = ""; box.style.height = "28px";
  const model = $("#model") ? $("#model").value : "Claude 3.7 Sonnet";
  api("POST", "/api/runs", { goal: text, model }).catch(() => trace("Server unreachable."));
}
if ($("#send")) $("#send").onclick = send;
if ($("#message")) {
  $("#message").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  $("#message").addEventListener("input", (e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 96) + "px"; });
}

// Model picker
const modelPicker = $("#modelPicker");
const modelTrigger = $("#modelTrigger");
const modelMenu = $("#modelMenu");
if (modelTrigger && modelMenu) {
  modelTrigger.onclick = (e) => {
    e.stopPropagation();
    const isOpen = modelMenu.style.display !== "none";
    modelMenu.style.display = isOpen ? "none" : "flex";
    modelPicker.classList.toggle("open", !isOpen);
    modelTrigger.setAttribute("aria-expanded", String(!isOpen));
  };
  $$(".model-opt").forEach((opt) => {
    opt.onclick = (e) => {
      e.stopPropagation();
      const model = opt.dataset.model;
      if ($("#model")) $("#model").value = model;
      if ($("#currentModelName")) $("#currentModelName").textContent = model;
      $$(".model-opt").forEach((o) => {
        o.classList.toggle("active", o === opt);
        o.setAttribute("aria-selected", String(o === opt));
      });
      modelMenu.style.display = "none";
      modelPicker.classList.remove("open");
      modelTrigger.setAttribute("aria-expanded", "false");
      trace(`Orchestrator model set to ${model}`);
    };
  });
  document.addEventListener("click", (e) => {
    if (modelPicker && !modelPicker.contains(e.target)) {
      modelMenu.style.display = "none";
      modelPicker.classList.remove("open");
      modelTrigger.setAttribute("aria-expanded", "false");
    }
  });
}

/* ---------- collapsible sidebars (Sessions & Logs) ---------- */
const appEl = $(".app");
function toggleLeftSidebar(force) {
  if (!appEl) return;
  const isCollapsed = typeof force === "boolean" ? force : !appEl.classList.contains("left-collapsed");
  appEl.classList.toggle("left-collapsed", isCollapsed);
  if ($("#btnToggleLeft")) {
    $("#btnToggleLeft").classList.toggle("active", isCollapsed);
    $("#btnToggleLeft").title = isCollapsed ? "Expand Sessions sidebar (o) (Alt+1)" : "Collapse Sessions sidebar (x) (Alt+1)";
    $("#btnToggleLeft").innerHTML = isCollapsed ? '<span style="font-weight:700;font-family:monospace;font-size:14px;line-height:1">o</span>' : '<i class="ti ti-layout-sidebar"></i>';
  }
  try { localStorage.setItem("overlord_left_col", isCollapsed ? "1" : "0"); } catch {}
}

function toggleRightSidebar(force) {
  if (!appEl) return;
  const isCollapsed = typeof force === "boolean" ? force : !appEl.classList.contains("right-collapsed");
  appEl.classList.toggle("right-collapsed", isCollapsed);
  if ($("#btnToggleRight")) {
    $("#btnToggleRight").classList.toggle("active", isCollapsed);
    $("#btnToggleRight").title = isCollapsed ? "Expand Logs feed (o) (Alt+2)" : "Collapse Logs feed (x) (Alt+2)";
    $("#btnToggleRight").innerHTML = isCollapsed ? '<span style="font-weight:700;font-family:monospace;font-size:14px;line-height:1">o</span>' : '<i class="ti ti-layout-sidebar-right"></i>';
  }
  try { localStorage.setItem("overlord_right_col", isCollapsed ? "1" : "0"); } catch {}
}

if ($("#btnToggleLeft")) $("#btnToggleLeft").onclick = () => toggleLeftSidebar();
if ($("#btnCollapseLeft")) $("#btnCollapseLeft").onclick = () => toggleLeftSidebar(true);
if ($("#btnToggleRight")) $("#btnToggleRight").onclick = () => toggleRightSidebar();
if ($("#btnCollapseRight")) $("#btnCollapseRight").onclick = () => toggleRightSidebar(true);

// Restore saved collapsed states
try {
  if (localStorage.getItem("overlord_left_col") === "1") toggleLeftSidebar(true);
  if (localStorage.getItem("overlord_right_col") === "1") toggleRightSidebar(true);
} catch {}

window.addEventListener("keydown", (e) => {
  if (e.altKey && (e.key === "1" || e.key === "b" || e.key === "B")) {
    e.preventDefault();
    toggleLeftSidebar();
  } else if (e.altKey && (e.key === "2" || e.key === "l" || e.key === "L")) {
    e.preventDefault();
    toggleRightSidebar();
  }
});

/* ---------- settings & views ---------- */
const UI_KEY = "overlord_ui";
let CFG = null;
let curSubpage = "supervisor";

function markTheme() {
  const t = document.documentElement.dataset.theme || "light";
  if ($("#btnThemeLight")) $("#btnThemeLight").style.borderColor = t === "light" ? "#2563eb" : "";
  if ($("#btnThemeDark")) $("#btnThemeDark").style.borderColor = t === "dark" ? "#2563eb" : "";
}
function setTheme(t) {
  document.documentElement.dataset.theme = t === "dark" ? "dark" : "";
  try { localStorage.setItem(UI_KEY, t); } catch {}
  markTheme();
}
try { if (localStorage.getItem(UI_KEY) === "dark") document.documentElement.dataset.theme = "dark"; } catch {}

function showPage(page) {
  const isSet = page === "settings";
  $("#navWorkspace").classList.toggle("active", !isSet);
  $("#navSettings").classList.toggle("active", isSet);
  $("#viewWorkspace").style.display = isSet ? "none" : "flex";
  $("#viewSettings").style.display = isSet ? "flex" : "none";
  $(".app").classList.toggle("settings-mode", isSet);
  if (isSet) openSettings();
}

$("#navWorkspace").onclick = () => showPage("workspace");
$("#navSettings").onclick = () => showPage("settings");
$("#btnBackToWorkspace").onclick = () => showPage("workspace");

// Sub-page switching inside Settings
$$(".set-nav-item").forEach((btn) => {
  btn.onclick = () => {
    $$(".set-nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    curSubpage = btn.dataset.sub;
    renderSubpage(curSubpage);
  };
});

function renderSubpage(sub) {
  $$(".sub-pane").forEach((p) => (p.style.display = "none"));
  const pane = $("#pane-" + sub);
  if (pane) pane.style.display = "block";
  if (sub === "supervisor") renderSupervisorPane();
  else if (sub === "agents") renderAgentsPane();
  else if (sub === "marketplace") renderMarketplacePane();
  else if (sub === "mcps") renderMcpsPane();
  else if (sub === "guardrails") renderGuardrailsPane();
  else if (sub === "appearance") renderAppearancePane();
}

async function openSettings() {
  try {
    CFG = await api("GET", "/api/config");
    normalizeCfg(CFG);
    renderSubpage(curSubpage);
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
}

function normalizeCfg(c) {
  if (!c) return;
  if (!c.supervisor) {
    c.supervisor = {
      skills: ["intent-parsing", "task-decomposition", "synthesis", "conflict-resolution"],
      tools: ["delegate_task", "request_approval", "inspect_context", "agent_spawn"],
      mcps: ["local"],
    };
  }
  if (!Array.isArray(c.supervisor.skills)) c.supervisor.skills = [];
  if (!Array.isArray(c.supervisor.tools)) c.supervisor.tools = [];
  if (!Array.isArray(c.supervisor.mcps)) c.supervisor.mcps = [];
  if (!Array.isArray(c.mcps)) c.mcps = [];
  if (Array.isArray(c.skills)) {
    c.skills.forEach((s) => {
      if (!Array.isArray(s.skills)) s.skills = [s.cap || "general"];
      if (!Array.isArray(s.tools)) s.tools = ["exec"];
      if (!Array.isArray(s.mcps)) s.mcps = ["local"];
    });
  }
}

async function pushCfg(mutator) {
  if (typeof mutator === "function") mutator(CFG);
  normalizeCfg(CFG);
  const tag = $("#setSaveTag");
  if (tag) tag.innerHTML = '<span class="dot" style="background:#f59e0b"></span> Saving...';
  try {
    const updated = await api("PUT", "/api/config", CFG);
    if (updated) CFG = updated;
    normalizeCfg(CFG);
    if (tag) tag.innerHTML = '<i class="ti ti-check"></i> Saved';
    syncAssignmentTable();
  } catch (err) {
    if (tag) tag.innerHTML = '<i class="ti ti-alert-circle" style="color:#ef4444"></i> Save Failed';
    console.error("pushCfg error:", err);
  }
}

function syncAssignmentTable() {
  if (!CFG || !Array.isArray(CFG.skills)) return;
  const table = $("#assignmentTable");
  if (!table) return;
  const activeSkills = CFG.skills.filter((s) => s.on);
  const rows = activeSkills.map((s) => {
    const iconClass = s.cap === "code" ? "green" : s.cap === "review" ? "violet" : "";
    const icon = s.cap === "research" ? "ti-world" : s.cap === "code" ? "ti-code" : s.cap === "review" ? "ti-chart-dots" : "ti-tool";
    const toolsStr = (s.tools || []).join(", ") || s.cap;
    return `<div><span class="agent-name"><span class="agent-icon ${iconClass}"><i class="ti ${icon}"></i></span>${esc(s.name)}</span></div><div>${esc(toolsStr)}</div><div><span class="state running"><span class="dot"></span>Ready</span></div><div>${esc(s.cap)} v1.0</div>`;
  }).join("");
  table.innerHTML = `<div class="assignment-head">Agent</div><div class="assignment-head">Responsibility / Tools</div><div class="assignment-head">State</div><div class="assignment-head">Model</div>` + rows;
}

/* ---------- 1. Supervisor Sub-page ---------- */
function renderSupervisorPane() {
  if (!CFG) return;
  const sup = CFG.supervisor;

  // Profile select
  const sel = $("#supProfileSelect");
  sel.innerHTML = CFG.profiles.map((p) => `<option value="${p.id}" ${p.id === CFG.active ? "selected" : ""}>${esc(p.name)} (${esc(p.domain)})</option>`).join("");
  sel.onchange = (e) => pushCfg((c) => { c.active = e.target.value; });

  // Profile list
  const pList = $("#supProfileList");
  pList.innerHTML = CFG.profiles.map((p) => `
    <div class="set-row" style="font-size:11px;padding:6px 0">
      <span><strong>${esc(p.name)}</strong> <small style="color:var(--muted)">· domain: ${esc(p.domain)}</small></span>
      <span>${CFG.profiles.length > 1 ? `<button class="ghost" data-delprof="${p.id}" style="padding:2px 8px;font-size:10px">del</button>` : `<small style="color:var(--muted)">default</small>`}</span>
    </div>`).join("");

  // Skills
  const sList = $("#supSkillsList");
  sList.innerHTML = sup.skills.map((sk) => `
    <span class="badge-item blue">
      <span>${esc(sk)}</span>
      <button class="badge-del" data-delsupskill="${esc(sk)}" title="Remove skill"><i class="ti ti-x"></i></button>
    </span>`).join("") || `<span style="color:var(--muted);font-size:10px">No supervisor skills assigned.</span>`;

  // Tools
  const tList = $("#supToolsList");
  tList.innerHTML = sup.tools.map((tl) => `
    <span class="badge-item violet">
      <span>${esc(tl)}</span>
      <button class="badge-del" data-delsuptool="${esc(tl)}" title="Remove tool"><i class="ti ti-x"></i></button>
    </span>`).join("") || `<span style="color:var(--muted);font-size:10px">No supervisor tools assigned.</span>`;

  // Attached MCPs Grid
  const mGrid = $("#supMcpsGrid");
  mGrid.innerHTML = CFG.mcps.map((m) => {
    const isChecked = sup.mcps.includes(m.id);
    return `
      <div class="mcp-check-card ${isChecked ? "checked" : ""}" data-togglesupmcp="${m.id}">
        <div class="mcp-check-head">
          <span><i class="ti ${isChecked ? "ti-checkbox" : "ti-square"}"></i> ${esc(m.name)}</span>
          <small style="color:${m.on ? "var(--green)" : "var(--muted)"}">${m.on ? "Active" : "Disabled"}</small>
        </div>
        <div class="mcp-check-tools">Tools: ${esc((m.tools || []).join(", "))}</div>
      </div>`;
  }).join("") || `<span style="color:var(--muted);font-size:10px">No registered MCP servers found.</span>`;
}

// Supervisor Add Profile
$("#addProfBtn").onclick = () => {
  const n = $("#addProfName").value.trim();
  const d = $("#addProfDomain").value.trim() || "general";
  if (!n) return;
  const id = n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  pushCfg((c) => {
    c.profiles.push({ id, name: n, domain: d });
    c.active = id;
  });
  $("#addProfName").value = "";
  $("#addProfDomain").value = "";
  renderSupervisorPane();
};

// Supervisor Add Skill
function addSupSkill(skill) {
  const sk = String(skill || "").trim().toLowerCase();
  if (!sk) return;
  if (!CFG.supervisor.skills.includes(sk)) {
    pushCfg((c) => c.supervisor.skills.push(sk));
    renderSupervisorPane();
  }
}
$("#addSupSkillBtn").onclick = () => {
  addSupSkill($("#addSupSkillInput").value);
  $("#addSupSkillInput").value = "";
};
$("#addSupSkillInput").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addSupSkill(e.target.value);
    e.target.value = "";
  }
};

// Supervisor Add Tool
function addSupTool(tool) {
  const tl = String(tool || "").trim();
  if (!tl) return;
  if (!CFG.supervisor.tools.includes(tl)) {
    pushCfg((c) => c.supervisor.tools.push(tl));
    renderSupervisorPane();
  }
}
$("#addSupToolBtn").onclick = () => {
  addSupTool($("#addSupToolInput").value);
  $("#addSupToolInput").value = "";
};
$("#addSupToolInput").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addSupTool(e.target.value);
    e.target.value = "";
  }
};

/* ---------- 2. Worker Agents Sub-page ---------- */
function renderAgentsPane() {
  if (!CFG) return;
  const container = $("#agentsListContainer");
  container.innerHTML = CFG.skills.map((agent) => {
    const skillsHtml = (agent.skills || []).map((sk) => `
      <span class="badge-item blue">
        <span>${esc(sk)}</span>
        <button class="badge-del" data-delagentskill="${agent.id}:${esc(sk)}" title="Remove skill"><i class="ti ti-x"></i></button>
      </span>`).join("") || `<span style="color:var(--muted);font-size:10px">No skills assigned.</span>`;

    const toolsHtml = (agent.tools || []).map((tl) => `
      <span class="badge-item violet">
        <span>${esc(tl)}</span>
        <button class="badge-del" data-delagenttool="${agent.id}:${esc(tl)}" title="Remove tool"><i class="ti ti-x"></i></button>
      </span>`).join("") || `<span style="color:var(--muted);font-size:10px">No tools assigned.</span>`;

    const mcpsHtml = CFG.mcps.map((m) => {
      const active = (agent.mcps || []).includes(m.id);
      return `<button class="mcp-pill ${active ? "active" : ""}" data-toggleagentmcp="${agent.id}:${m.id}">
        <i class="ti ${active ? "ti-check" : "ti-plus"}"></i>${esc(m.name)}
      </button>`;
    }).join("");

    return `
      <div class="agent-config-card">
        <div class="agent-card-head">
          <div style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" data-agenttoggle="${agent.id}" ${agent.on ? "checked" : ""} style="cursor:pointer"/>
            <strong>${esc(agent.name)}</strong>
            <small style="color:var(--muted)">(${esc(agent.id)})</small>
            <select data-agentcap="${agent.id}" style="padding:2px 6px;border:1px solid var(--border);border-radius:4px;font-size:10px;background:var(--surface);color:var(--text)">
              ${CAPS.map((k) => `<option ${k === agent.cap ? "selected" : ""}>${k}</option>`).join("")}
              <option ${agent.cap === "custom" ? "selected" : ""}>custom</option>
            </select>
          </div>
          <div>
            <button class="ghost" data-delagent="${agent.id}" style="color:#ef4444;border-color:#fecaca;padding:2px 8px;font-size:10px"><i class="ti ti-trash"></i> Delete</button>
          </div>
        </div>

        <div>
          <div class="agent-subhead">Agent Skills</div>
          <div class="badge-wrap">${skillsHtml}</div>
          <div class="add-inline">
            <input class="in-agent-skill" data-agentid="${agent.id}" placeholder="Add skill to ${esc(agent.name)}..." />
            <button class="btn-add-agent-skill" data-agentid="${agent.id}">Add</button>
          </div>
        </div>

        <div style="margin-top:10px">
          <div class="agent-subhead">Agent Tools</div>
          <div class="badge-wrap">${toolsHtml}</div>
          <div class="add-inline">
            <input class="in-agent-tool" data-agentid="${agent.id}" placeholder="Add tool to ${esc(agent.name)}..." />
            <button class="btn-add-agent-tool" data-agentid="${agent.id}">Add</button>
          </div>
        </div>

        <div style="margin-top:10px">
          <div class="agent-subhead">Attached MCP Servers</div>
          <div class="mcp-pills">${mcpsHtml || `<small style="color:var(--muted)">No MCP servers registered</small>`}</div>
        </div>
      </div>`;
  }).join("");
}

// Toggle New Agent Box
$("#toggleAddAgent").onclick = () => {
  const b = $("#newAgentBox");
  b.style.display = b.style.display === "none" ? "block" : "none";
};
$("#cancelAddAgent").onclick = () => { $("#newAgentBox").style.display = "none"; };

// Create New Agent
$("#saveNewAgentBtn").onclick = () => {
  const name = $("#newAgentName").value.trim();
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const cap = $("#newAgentCap").value;
  const skills = $("#newAgentSkills").value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const tools = $("#newAgentTools").value.split(",").map((s) => s.trim()).filter(Boolean);
  const newAgent = {
    id,
    name,
    cap,
    skills: skills.length ? skills : [cap],
    tools: tools.length ? tools : ["exec"],
    mcps: ["local"],
    on: true,
  };
  pushCfg((c) => c.skills.push(newAgent));
  $("#newAgentName").value = "";
  $("#newAgentSkills").value = "";
  $("#newAgentTools").value = "";
  $("#newAgentBox").style.display = "none";
  renderAgentsPane();
};

/* ---------- Marketplace & Capability Registry ---------- */
let marketFilter = "all";
let marketQuery = "";

const MARKETPLACE_CATALOG = [
  // --- Skills ---
  {
    id: "ponytail",
    name: "Ponytail (Lazy Senior Dev)",
    type: "skill",
    source: "DietrichGebert/ponytail",
    icon: "ti-code",
    desc: "Enforces YAGNI, standard library first, native platform features before dependencies, minimal working code. Shortest diff wins.",
    tags: ["skill", "code-quality", "yagni", "minimalist"],
    badge: "Verified"
  },
  {
    id: "code-review",
    name: "Automated Code Reviewer",
    type: "skill",
    source: "ecc/common/code-review",
    icon: "ti-file-search",
    desc: "Examines diffs for security vulnerabilities, line length, deep nesting, missing error handling, and test coverage.",
    tags: ["skill", "code-review", "security", "qa"],
    badge: "Official"
  },
  {
    id: "tdd-workflow",
    name: "Test-Driven Development (TDD)",
    type: "skill",
    source: "ecc/common/testing",
    icon: "ti-checkup-list",
    desc: "Enforces strict RED-GREEN-REFACTOR cycle with AAA test naming and mandatory >80% code coverage.",
    tags: ["skill", "tdd", "testing", "coverage"],
    badge: "Official"
  },
  {
    id: "security-guard",
    name: "Security & OWASP Guard",
    type: "skill",
    source: "ecc/common/security",
    icon: "ti-shield-lock",
    desc: "Audits for hardcoded secrets, SQL injection, XSS, insecure deserialization, SSRF, and authentication bypasses.",
    tags: ["skill", "security", "owasp", "audit"],
    badge: "Security"
  },
  {
    id: "web-scraper",
    name: "High-Throughput Web Scraper",
    type: "skill",
    source: "community/web-scraper",
    icon: "ti-spider",
    desc: "Automates article extraction, DOM parsing, structured data synthesis, and pagination handling with resilient retries.",
    tags: ["skill", "scraping", "web", "extraction"],
    badge: "Popular"
  },
  {
    id: "data-analyzer",
    name: "Data Science & Pandas Analysis",
    type: "skill",
    source: "community/data-analyzer",
    icon: "ti-chart-line",
    desc: "Performs statistical summaries, correlation matrices, anomaly detection, CSV/JSON munging, and insights generation.",
    tags: ["skill", "data-science", "pandas", "stats"],
    badge: "Popular"
  },
  {
    id: "react-patterns",
    name: "React 19 & Next.js Architecture",
    type: "skill",
    source: "ecc/react/patterns",
    icon: "ti-brand-react",
    desc: "Enforces Server/Client boundaries, Suspense error handling, custom hook discipline, and render optimization.",
    tags: ["skill", "react", "frontend", "nextjs"],
    badge: "Official"
  },
  {
    id: "fastapi-patterns",
    name: "FastAPI & Async Architecture",
    type: "skill",
    source: "ecc/python/fastapi",
    icon: "ti-brand-python",
    desc: "Pydantic v2 validation, async handlers, dependency injection, and transaction-safe service layers.",
    tags: ["skill", "fastapi", "python", "backend"],
    badge: "Official"
  },
  {
    id: "a11y-architect",
    name: "WCAG 2.2 Accessibility Auditor",
    type: "skill",
    source: "ecc/web/accessibility",
    icon: "ti-eye-check",
    desc: "Audits color contrast, ARIA landmarks, keyboard focus rings, and screen-reader accessibility traits.",
    tags: ["skill", "a11y", "wcag", "inclusive"],
    badge: "Standard"
  },

  // --- Tools ---
  {
    id: "web_search",
    name: "Web Search Engine",
    type: "tool",
    source: "native/search",
    icon: "ti-world-search",
    desc: "Real-time web search and public documentation retriever for live facts and fresh technical docs.",
    tags: ["tool", "search", "web", "docs"],
    badge: "Native"
  },
  {
    id: "python_repl",
    name: "Interactive Python REPL",
    type: "tool",
    source: "native/repl",
    icon: "ti-terminal-2",
    desc: "In-process execution environment for data calculation, mathematical modeling, and script verification.",
    tags: ["tool", "python", "execution", "repl"],
    badge: "Execution"
  },
  {
    id: "bash_exec",
    name: "Sandboxed Terminal Runner",
    type: "tool",
    source: "native/bash",
    icon: "ti-terminal",
    desc: "Runs shell commands, tests, package installs, and builds with timeout protection and standard output capture.",
    tags: ["tool", "shell", "bash", "cli"],
    badge: "System"
  },
  {
    id: "browser_automation",
    name: "Playwright Browser Engine",
    type: "tool",
    source: "native/playwright",
    icon: "ti-app-window",
    desc: "Automates browser navigation, DOM clicks, form entry, screenshot capture, and E2E regression testing.",
    tags: ["tool", "browser", "automation", "e2e"],
    badge: "Popular"
  },
  {
    id: "sql_query",
    name: "Universal SQL Query Runner",
    type: "tool",
    source: "native/db",
    icon: "ti-database",
    desc: "Direct database query engine supporting PostgreSQL, SQLite, MySQL, and Supabase connections.",
    tags: ["tool", "sql", "database", "postgres"],
    badge: "Data"
  },
  {
    id: "git_ops",
    name: "Git VCS Operations",
    type: "tool",
    source: "native/git",
    icon: "ti-git-branch",
    desc: "Commit generation, branching, diff inspections, conflict resolutions, and staging management.",
    tags: ["tool", "git", "vcs", "branch"],
    badge: "Native"
  },

  // --- MCP Servers ---
  {
    id: "github-mcp",
    name: "GitHub MCP Server",
    type: "mcp",
    source: "github/github-mcp-server",
    icon: "ti-brand-github",
    desc: "Connects OVERLORD to GitHub API: manage PRs, file issues, inspect commit diffs, and query repo search.",
    tools: ["pull_request", "issue_read", "commit", "search_code"],
    tags: ["mcp", "github", "vcs", "pr"],
    badge: "Popular"
  },
  {
    id: "filesystem-mcp",
    name: "Secure Filesystem MCP",
    type: "mcp",
    source: "modelcontextprotocol/servers",
    icon: "ti-folder",
    desc: "Provides sandboxed read/write access to project directories with configurable path boundaries.",
    tools: ["read_file", "write_file", "list_dir", "file_search"],
    tags: ["mcp", "fs", "io", "system"],
    badge: "Core"
  },
  {
    id: "postgres-mcp",
    name: "PostgreSQL Database MCP",
    type: "mcp",
    source: "modelcontextprotocol/servers",
    icon: "ti-database",
    desc: "Direct relational database inspection: introspect schemas, query tables, analyze execution plans.",
    tools: ["sql_query", "list_tables", "describe_table"],
    tags: ["mcp", "database", "postgres", "sql"],
    badge: "Popular"
  },
  {
    id: "slack-mcp",
    name: "Slack Collaboration MCP",
    type: "mcp",
    source: "modelcontextprotocol/servers",
    icon: "ti-brand-slack",
    desc: "Send notifications to Slack channels, dispatch alert summaries, and monitor incident discussions.",
    tools: ["post_message", "read_channel", "list_users"],
    tags: ["mcp", "slack", "chat", "alerts"],
    badge: "Integration"
  },
  {
    id: "docker-mcp",
    name: "Docker Container MCP",
    type: "mcp",
    source: "modelcontextprotocol/servers",
    icon: "ti-brand-docker",
    desc: "Inspect active containers, tail service logs, monitor container health, and trigger restarts.",
    tools: ["container_list", "container_logs", "image_inspect"],
    tags: ["mcp", "docker", "devops", "containers"],
    badge: "DevOps"
  },

  // --- Agent Templates ---
  {
    id: "template-fullstack",
    name: "Full-Stack Architect Agent",
    type: "template",
    source: "templates/fullstack",
    icon: "ti-layout-grid",
    desc: "Specialized in end-to-end architecture: frontend components, backend REST/GraphQL APIs, and database migrations.",
    cap: "code",
    skills: ["architecture", "react-patterns", "fastapi-patterns", "tdd-workflow"],
    tools: ["file_editor", "git_ops", "bash_exec"],
    mcps: ["local", "github-mcp", "filesystem-mcp"],
    tags: ["template", "fullstack", "architecture", "agent"],
    badge: "Pack"
  },
  {
    id: "template-security",
    name: "Security & Compliance Auditor",
    type: "template",
    source: "templates/security",
    icon: "ti-shield-bolt",
    desc: "Dedicated to vulnerability auditing, secret scanning, dependency CVE alerts, and OWASP compliance checking.",
    cap: "review",
    skills: ["security-guard", "code-review", "audit"],
    tools: ["file_editor", "bash_exec"],
    mcps: ["local", "filesystem-mcp"],
    tags: ["template", "security", "audit", "agent"],
    badge: "Pack"
  },
  {
    id: "template-analyst",
    name: "Deep Research & Data Analyst",
    type: "template",
    source: "templates/analyst",
    icon: "ti-microscope",
    desc: "Gathers web evidence, analyzes large CSV/JSON datasets, runs statistical models, and produces markdown reports.",
    cap: "research",
    skills: ["web-scraper", "data-analyzer", "synthesis"],
    tools: ["web_search", "python_repl", "browser_automation"],
    mcps: ["local", "filesystem-mcp"],
    tags: ["template", "research", "data", "agent"],
    badge: "Pack"
  },
  {
    id: "template-devops",
    name: "DevOps & Infrastructure Lead",
    type: "template",
    source: "templates/devops",
    icon: "ti-cloud-computing",
    desc: "Specialized in CI/CD pipeline automation, Docker builds, Kubernetes manifests, and container observability.",
    cap: "exec",
    skills: ["devops", "docker", "ci-cd", "bash_exec"],
    tools: ["bash_exec", "git_ops"],
    mcps: ["local", "docker-mcp"],
    tags: ["template", "devops", "docker", "cloud"],
    badge: "Pack"
  }
];

function showMarketToast(msg) {
  const t = $("#marketToast");
  const m = $("#marketToastMsg");
  if (!t || !m) return;
  m.textContent = msg;
  t.style.display = "flex";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = "none"; }, 3500);
}

function installCustomPackage(source, type) {
  const src = String(source || "").trim();
  if (!src) return;
  const id = src.split("/").pop().replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  
  if (type === "skill") {
    pushCfg((c) => {
      if (!c.supervisor.skills.includes(id)) c.supervisor.skills.push(id);
    });
    showMarketToast(`Installed skill "${id}" from ${src} into Supervisor.`);
  } else if (type === "tool") {
    pushCfg((c) => {
      if (!c.supervisor.tools.includes(id)) c.supervisor.tools.push(id);
    });
    showMarketToast(`Installed tool "${id}" from ${src} into Supervisor.`);
  } else if (type === "mcp") {
    pushCfg((c) => {
      if (!c.mcps.some((m) => m.id === id)) {
        c.mcps.push({ id, name: src, tools: ["query", "exec"], on: true });
      }
      if (!c.supervisor.mcps.includes(id)) c.supervisor.mcps.push(id);
    });
    showMarketToast(`Registered MCP server "${id}" and attached to Supervisor.`);
  }
  renderMarketplacePane();
}

function renderMarketplacePane() {
  if (!CFG) return;
  const q = marketQuery.trim().toLowerCase();

  // Search input & filter event listeners (idempotent)
  const searchInp = $("#marketSearchInp");
  if (searchInp && !searchInp._bound) {
    searchInp._bound = true;
    searchInp.oninput = (e) => {
      marketQuery = e.target.value;
      renderMarketplacePane();
    };
  }

  $$(".market-filter-btn").forEach((btn) => {
    if (!btn._bound) {
      btn._bound = true;
      btn.onclick = () => {
        $$(".market-filter-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        marketFilter = btn.dataset.marketfilter;
        renderMarketplacePane();
      };
    }
  });

  const isInstalled = (item) => {
    if (item.type === "skill") {
      return CFG.supervisor.skills.includes(item.id) || CFG.skills.some((a) => (a.skills || []).includes(item.id));
    }
    if (item.type === "tool") {
      return CFG.supervisor.tools.includes(item.id) || CFG.skills.some((a) => (a.tools || []).includes(item.id));
    }
    if (item.type === "mcp") {
      return CFG.mcps.some((m) => m.id === item.id);
    }
    if (item.type === "template") {
      const bareId = item.id.replace("template-", "");
      return CFG.skills.some((a) => a.id.startsWith(bareId));
    }
    return false;
  };

  const filtered = MARKETPLACE_CATALOG.filter((item) => {
    if (marketFilter === "installed" && !isInstalled(item)) return false;
    if (marketFilter !== "all" && marketFilter !== "installed" && item.type !== marketFilter) return false;
    if (q) {
      const matchName = item.name.toLowerCase().includes(q);
      const matchId = item.id.toLowerCase().includes(q);
      const matchDesc = item.desc.toLowerCase().includes(q);
      const matchTags = (item.tags || []).some((t) => t.toLowerCase().includes(q));
      if (!matchName && !matchId && !matchDesc && !matchTags) return false;
    }
    return true;
  });

  const badge = $("#marketCountBadge");
  if (badge) badge.textContent = `${filtered.length} of ${MARKETPLACE_CATALOG.length} items`;

  const container = $("#marketGridContainer");
  if (!container) return;

  if (!filtered.length) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:36px 12px;color:var(--muted)">
        <i class="ti ti-mood-empty" style="font-size:32px;display:block;margin-bottom:8px"></i>
        <strong>No items match "${esc(q || marketFilter)}"</strong>
        <p style="font-size:11px;margin-top:4px">Try another search term or install custom repos with the installer above.</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map((item) => {
    const installed = isInstalled(item);
    let actionHtml = "";

    if (item.type === "skill") {
      const inSup = CFG.supervisor.skills.includes(item.id);
      actionHtml = `
        <div class="market-btn-group">
          <button class="market-action-btn ${inSup ? "installed" : "primary"}" data-addmarketskill-sup="${item.id}" ${inSup ? "disabled" : ""}>
            <i class="ti ${inSup ? "ti-check" : "ti-crown"}"></i> ${inSup ? "In Supervisor" : "+ Supervisor"}
          </button>
          <select class="market-agent-select" data-marketskill="${item.id}" style="font-size:10px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
            <option value="">+ Assign Agent...</option>
            ${CFG.skills.map((a) => {
              const has = (a.skills || []).includes(item.id);
              return `<option value="${a.id}">${has ? "âœ“ " : "+ "}${esc(a.name)}</option>`;
            }).join("")}
          </select>
        </div>`;
    } else if (item.type === "tool") {
      const inSup = CFG.supervisor.tools.includes(item.id);
      actionHtml = `
        <div class="market-btn-group">
          <button class="market-action-btn ${inSup ? "installed" : "primary"}" data-addmarkettool-sup="${item.id}" ${inSup ? "disabled" : ""}>
            <i class="ti ${inSup ? "ti-check" : "ti-crown"}"></i> ${inSup ? "In Supervisor" : "+ Supervisor"}
          </button>
          <select class="market-agent-tool-select" data-markettool="${item.id}" style="font-size:10px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
            <option value="">+ Assign Agent...</option>
            ${CFG.skills.map((a) => {
              const has = (a.tools || []).includes(item.id);
              return `<option value="${a.id}">${has ? "âœ“ " : "+ "}${esc(a.name)}</option>`;
            }).join("")}
          </select>
        </div>`;
    } else if (item.type === "mcp") {
      actionHtml = `
        <div class="market-btn-group">
          ${installed ? `
            <span class="market-action-btn installed"><i class="ti ti-check"></i> Registered</span>
          ` : `
            <button class="market-action-btn primary" data-installmcp="${item.id}">
              <i class="ti ti-plus"></i> Register &amp; Enable
            </button>
          `}
        </div>`;
    } else if (item.type === "template") {
      actionHtml = `
        <div class="market-btn-group">
          <button class="market-action-btn primary" data-spawntemplate="${item.id}">
            <i class="ti ti-robot"></i> + Instantiate Agent
          </button>
        </div>`;
    }

    return `
      <div class="market-card">
        <div>
          <div class="market-card-head">
            <div class="market-card-title">
              <i class="ti ${item.icon || "ti-box"}" style="color:var(--blue);font-size:16px"></i>
              <span>${esc(item.name)}</span>
            </div>
            <span class="market-badge ${item.type}">${item.badge || item.type}</span>
          </div>
          <div class="market-card-source">${esc(item.source)}</div>
          <div class="market-card-desc" style="margin-top:8px">${esc(item.desc)}</div>
        </div>

        <div>
          <div class="market-card-tags">
            ${(item.tags || []).map((t) => `<span class="market-tag">#${esc(t)}</span>`).join("")}
          </div>
          <div class="market-card-foot">
            <small style="color:${installed ? "var(--green)" : "var(--muted)"};font-size:9px;font-weight:600">
              <i class="ti ${installed ? "ti-circle-check" : "ti-circle"}"></i> ${installed ? "Active in system" : "Available"}
            </small>
            ${actionHtml}
          </div>
        </div>
      </div>`;
  }).join("");
}

/* ---------- 3. MCPs & Tools Sub-page ---------- */
function renderMcpsPane() {
  if (!CFG) return;
  const list = $("#mcpRegistryList");
  list.innerHTML = CFG.mcps.map((m) => `
    <div class="set-row" style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" data-mcpon="${m.id}" ${m.on ? "checked" : ""} style="cursor:pointer"/>
        <div>
          <strong style="font-size:12px">${esc(m.name)}</strong> <small style="color:var(--muted)">(${esc(m.id)})</small>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">Tools: ${esc((m.tools || []).join(", "))}</div>
        </div>
      </div>
      <div>
        <button class="ghost" data-delmcp="${m.id}" style="padding:3px 8px;font-size:10px;color:#ef4444">Remove</button>
      </div>
    </div>`).join("") || `<div style="color:var(--muted);font-size:11px">No MCP servers registered yet.</div>`;
}

$("#newMcpBtn").onclick = () => {
  const n = $("#newMcpName").value.trim();
  if (!n) return;
  const id = n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const tools = $("#newMcpTools").value.split(",").map((s) => s.trim()).filter(Boolean);
  pushCfg((c) => c.mcps.push({ id, name: n, tools: tools.length ? tools : ["read", "write"], on: true }));
  $("#newMcpName").value = "";
  $("#newMcpTools").value = "";
  renderMcpsPane();
};

/* ---------- 4. Guardrails Sub-page ---------- */
function renderGuardrailsPane() {
  if (!CFG) return;
  const g = CFG.guard || { maxSteps: 8, timeoutS: 120, costCap: 5, approval: false };
  $("#set-g-steps").value = g.maxSteps;
  $("#set-g-time").value = g.timeoutS;
  $("#set-g-cost").value = g.costCap;
  $("#set-g-appr").checked = !!g.approval;
}

$("#set-g-steps").onchange = (e) => pushCfg((c) => { c.guard.maxSteps = +e.target.value || 8; });
$("#set-g-time").onchange = (e) => pushCfg((c) => { c.guard.timeoutS = +e.target.value || 120; });
$("#set-g-cost").onchange = (e) => pushCfg((c) => { c.guard.costCap = +e.target.value || 5; });
$("#set-g-appr").onchange = (e) => pushCfg((c) => { c.guard.approval = e.target.checked; });

/* ---------- 5. Appearance Sub-page ---------- */
function renderAppearancePane() {
  markTheme();
}
$("#btnThemeLight").onclick = () => setTheme("light");
$("#btnThemeDark").onclick = () => setTheme("dark");

/* ---------- Global Settings Event Delegation ---------- */
$("#viewSettings").addEventListener("click", (e) => {
  const t = e.target.closest("button") || e.target;

  // Profile deletion
  if (t.matches("[data-delprof]")) {
    const id = t.dataset.delprof;
    pushCfg((c) => {
      c.profiles = c.profiles.filter((p) => p.id !== id);
      if (c.active === id && c.profiles.length) c.active = c.profiles[0].id;
    });
    renderSupervisorPane();
  }
  // Supervisor skill delete
  else if (t.matches("[data-delsupskill]")) {
    const sk = t.dataset.delsupskill;
    pushCfg((c) => { c.supervisor.skills = c.supervisor.skills.filter((s) => s !== sk); });
    renderSupervisorPane();
  }
  // Supervisor tool delete
  else if (t.matches("[data-delsuptool]")) {
    const tl = t.dataset.delsuptool;
    pushCfg((c) => { c.supervisor.tools = c.supervisor.tools.filter((x) => x !== tl); });
    renderSupervisorPane();
  }
  // Supervisor skill suggestion chip
  else if (t.matches("[data-supskill]")) {
    addSupSkill(t.dataset.supskill);
  }
  // Supervisor tool suggestion chip
  else if (t.matches("[data-suptool]")) {
    addSupTool(t.dataset.suptool);
  }
  // Supervisor MCP toggle
  else if (t.closest("[data-togglesupmcp]")) {
    const card = t.closest("[data-togglesupmcp]");
    const mcpId = card.dataset.togglesupmcp;
    pushCfg((c) => {
      const idx = c.supervisor.mcps.indexOf(mcpId);
      if (idx >= 0) c.supervisor.mcps.splice(idx, 1);
      else c.supervisor.mcps.push(mcpId);
    });
    renderSupervisorPane();
  }
  // Agent delete
  else if (t.matches("[data-delagent]")) {
    const id = t.dataset.delagent;
    pushCfg((c) => { c.skills = c.skills.filter((a) => a.id !== id); });
    renderAgentsPane();
  }
  // Agent skill delete
  else if (t.matches("[data-delagentskill]")) {
    const [agentId, skill] = t.dataset.delagentskill.split(":");
    pushCfg((c) => {
      const a = c.skills.find((x) => x.id === agentId);
      if (a && a.skills) a.skills = a.skills.filter((s) => s !== skill);
    });
    renderAgentsPane();
  }
  // Agent tool delete
  else if (t.matches("[data-delagenttool]")) {
    const [agentId, tool] = t.dataset.delagenttool.split(":");
    pushCfg((c) => {
      const a = c.skills.find((x) => x.id === agentId);
      if (a && a.tools) a.tools = a.tools.filter((x) => x !== tool);
    });
    renderAgentsPane();
  }
  // Agent add skill button
  else if (t.matches(".btn-add-agent-skill")) {
    const agentId = t.dataset.agentid;
    const inp = $(`input.in-agent-skill[data-agentid="${agentId}"]`);
    if (!inp) return;
    const val = inp.value.trim().toLowerCase();
    if (!val) return;
    pushCfg((c) => {
      const a = c.skills.find((x) => x.id === agentId);
      if (a) {
        if (!a.skills) a.skills = [];
        if (!a.skills.includes(val)) a.skills.push(val);
      }
    });
    inp.value = "";
    renderAgentsPane();
  }
  // Agent add tool button
  else if (t.matches(".btn-add-agent-tool")) {
    const agentId = t.dataset.agentid;
    const inp = $(`input.in-agent-tool[data-agentid="${agentId}"]`);
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) return;
    pushCfg((c) => {
      const a = c.skills.find((x) => x.id === agentId);
      if (a) {
        if (!a.tools) a.tools = [];
        if (!a.tools.includes(val)) a.tools.push(val);
      }
    });
    inp.value = "";
    renderAgentsPane();
  }
  // Agent MCP toggle pill
  else if (t.closest("[data-toggleagentmcp]")) {
    const pill = t.closest("[data-toggleagentmcp]");
    const [agentId, mcpId] = pill.dataset.toggleagentmcp.split(":");
    pushCfg((c) => {
      const a = c.skills.find((x) => x.id === agentId);
      if (a) {
        if (!a.mcps) a.mcps = [];
        const idx = a.mcps.indexOf(mcpId);
        if (idx >= 0) a.mcps.splice(idx, 1);
        else a.mcps.push(mcpId);
      }
    });
    renderAgentsPane();
  }
  // MCP delete in registry
  else if (t.matches("[data-delmcp]")) {
    const mcpId = t.dataset.delmcp;
    pushCfg((c) => {
      c.mcps = c.mcps.filter((m) => m.id !== mcpId);
      c.supervisor.mcps = c.supervisor.mcps.filter((id) => id !== mcpId);
      c.skills.forEach((a) => { if (a.mcps) a.mcps = a.mcps.filter((id) => id !== mcpId); });
    });
    renderMcpsPane();
  }
  // Marketplace quick install chip
  else if (t.matches("[data-quickinstall]")) {
    const [source, type] = t.dataset.quickinstall.split(":");
    installCustomPackage(source, type || "skill");
  }
  // Marketplace custom install button
  else if (t.id === "marketInstallBtn" || t.closest("#marketInstallBtn")) {
    const src = $("#marketCustomSource") ? $("#marketCustomSource").value.trim() : "";
    const typ = $("#marketCustomType") ? $("#marketCustomType").value : "skill";
    if (src) {
      installCustomPackage(src, typ);
      if ($("#marketCustomSource")) $("#marketCustomSource").value = "";
    }
  }
  // Marketplace add skill to supervisor
  else if (t.matches("[data-addmarketskill-sup]")) {
    const sk = t.dataset.addmarketskillSup;
    pushCfg((c) => {
      if (!c.supervisor.skills.includes(sk)) c.supervisor.skills.push(sk);
    });
    showMarketToast(`Added skill "${sk}" to Supervisor.`);
    renderMarketplacePane();
  }
  // Marketplace add tool to supervisor
  else if (t.matches("[data-addmarkettool-sup]")) {
    const tl = t.dataset.addmarkettoolSup;
    pushCfg((c) => {
      if (!c.supervisor.tools.includes(tl)) c.supervisor.tools.push(tl);
    });
    showMarketToast(`Added tool "${tl}" to Supervisor.`);
    renderMarketplacePane();
  }
  // Marketplace install & register MCP
  else if (t.matches("[data-installmcp]")) {
    const mcpId = t.dataset.installmcp;
    const cat = MARKETPLACE_CATALOG.find((x) => x.id === mcpId);
    if (cat) {
      pushCfg((c) => {
        if (!c.mcps.some((m) => m.id === cat.id)) {
          c.mcps.push({ id: cat.id, name: cat.name, tools: cat.tools || ["query"], on: true });
        }
        if (!c.supervisor.mcps.includes(cat.id)) c.supervisor.mcps.push(cat.id);
      });
      showMarketToast(`Registered & enabled MCP server "${cat.name}".`);
      renderMarketplacePane();
    }
  }
  // Marketplace instantiate agent template
  else if (t.matches("[data-spawntemplate]")) {
    const tmplId = t.dataset.spawntemplate;
    const tmpl = MARKETPLACE_CATALOG.find((x) => x.id === tmplId);
    if (tmpl) {
      const bareId = tmpl.id.replace("template-", "");
      const newAgent = {
        id: bareId + "-" + Math.floor(Math.random() * 1000),
        name: tmpl.name.replace(" Agent", ""),
        cap: tmpl.cap || "custom",
        skills: [...(tmpl.skills || [])],
        tools: [...(tmpl.tools || [])],
        mcps: [...(tmpl.mcps || ["local"])],
        on: true,
      };
      pushCfg((c) => c.skills.push(newAgent));
      showMarketToast(`Instantiated new specialized agent "${newAgent.name}".`);
      renderMarketplacePane();
    }
  }
});

$("#viewSettings").addEventListener("change", (e) => {
  const t = e.target;
  // Agent capability change
  if (t.matches("[data-agentcap]")) {
    const id = t.dataset.agentcap;
    pushCfg((c) => {
      const a = c.skills.find((x) => x.id === id);
      if (a) a.cap = t.value;
    });
  }
  // Agent toggle on/off
  else if (t.matches("[data-agenttoggle]")) {
    const id = t.dataset.agenttoggle;
    pushCfg((c) => {
      const a = c.skills.find((x) => x.id === id);
      if (a) a.on = t.checked;
    });
  }
  // MCP on/off in registry
  else if (t.matches("[data-mcpon]")) {
    const id = t.dataset.mcpon;
    pushCfg((c) => {
      const m = c.mcps.find((x) => x.id === id);
      if (m) m.on = t.checked;
    });
  }
  // Marketplace assign skill to agent
  else if (t.matches(".market-agent-select")) {
    const skillId = t.dataset.marketskill;
    const agentId = t.value;
    if (!agentId || !skillId) return;
    pushCfg((c) => {
      const a = c.skills.find((x) => x.id === agentId);
      if (a) {
        if (!a.skills) a.skills = [];
        if (!a.skills.includes(skillId)) a.skills.push(skillId);
      }
    });
    const aObj = CFG.skills.find((x) => x.id === agentId);
    showMarketToast(`Assigned skill "${skillId}" to ${aObj ? aObj.name : agentId}.`);
    t.value = "";
    renderMarketplacePane();
  }
  // Marketplace assign tool to agent
  else if (t.matches(".market-agent-tool-select")) {
    const toolId = t.dataset.markettool;
    const agentId = t.value;
    if (!agentId || !toolId) return;
    pushCfg((c) => {
      const a = c.skills.find((x) => x.id === agentId);
      if (a) {
        if (!a.tools) a.tools = [];
        if (!a.tools.includes(toolId)) a.tools.push(toolId);
      }
    });
    const aObj = CFG.skills.find((x) => x.id === agentId);
    showMarketToast(`Assigned tool "${toolId}" to ${aObj ? aObj.name : agentId}.`);
    t.value = "";
    renderMarketplacePane();
  }
});

/* ---------- boot ---------- */
(async function boot() {
  try {
    const [d, c] = await Promise.all([
      api("GET", "/api/logs?limit=100"),
      api("GET", "/api/config").catch(() => null),
    ]);
    logs = d.logs.map((e) => ({ time: e.ts.slice(11, 19), type: tagOf(e), actor: e.source.toUpperCase(), message: labelOf(e) }));
    if (c) {
      CFG = c;
      normalizeCfg(CFG);
      syncAssignmentTable();
    }
  } catch { trace("Server unreachable — start it with: node server.js"); return; }
  renderLogs();
  trace("Console connected · waiting for instructions.");
  const es = new EventSource("/api/stream");
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch {} };
})();