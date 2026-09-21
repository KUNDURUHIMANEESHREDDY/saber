// harness server — zero dependencies, node builtins only.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, "public");
const STORE = path.join(__dirname, "store.json");

function defCfg() {
  return {
    active: "generalist",
    profiles: [
      { id: "generalist", name: "Generalist", domain: "general" },
      { id: "coder", name: "Code Lead", domain: "software" },
    ],
    supervisor: {
      skills: ["intent-parsing", "task-decomposition", "synthesis", "conflict-resolution"],
      tools: ["delegate_task", "request_approval", "inspect_context", "agent_spawn"],
      mcps: ["local"],
    },
    skills: [
      { id: "researcher", name: "Web Researcher", cap: "research", skills: ["web-search", "content-extraction", "summarization"], tools: ["read_context", "fetch_url", "search_web"], mcps: ["local"], on: true },
      { id: "coder", name: "Code Engineer", cap: "code", skills: ["javascript", "python", "refactoring"], tools: ["draft_change", "format_code", "syntax_check"], mcps: ["local"], on: true },
      { id: "tools", name: "System Executor", cap: "exec", skills: ["shell-exec", "file-io", "docker"], tools: ["exec_cmd", "write_file", "read_file"], mcps: ["local"], on: true },
      { id: "critic", name: "Quality Critic", cap: "review", skills: ["security-audit", "diff-review", "validation"], tools: ["review_diff", "verify_contract", "lint"], mcps: ["local"], on: true },
    ],
    mcps: [
      { id: "local", name: "local-tools", tools: ["fetch", "exec", "write"], on: true },
      { id: "github", name: "github-mcp", tools: ["pull_request", "issue_read", "commit"], on: true },
      { id: "filesystem", name: "filesystem-mcp", tools: ["read_file", "write_file", "list_dir"], on: true },
    ],
    guard: { maxSteps: 8, timeoutS: 120, costCap: 5, approval: false },
  };
}

let store = { logs: [], config: defCfg(), seq: 0 };
try {
  const raw = JSON.parse(fs.readFileSync(STORE, "utf8"));
  if (raw && Array.isArray(raw.logs) && raw.config) {
    store = raw;
    // ponytail: migration ceiling for existing store.json shapes. Replace with formal schema migration when versioned.
    if (!store.config.supervisor) store.config.supervisor = defCfg().supervisor;
    if (!Array.isArray(store.config.mcps) || !store.config.mcps.length) store.config.mcps = defCfg().mcps;
    if (Array.isArray(store.config.skills)) {
      store.config.skills.forEach((s) => {
        if (!Array.isArray(s.skills)) s.skills = [s.cap || "general"];
        if (!Array.isArray(s.tools)) s.tools = ["exec"];
        if (!Array.isArray(s.mcps)) s.mcps = ["local"];
      });
    }
  }
} catch {}
function persist() {
  try { fs.writeFileSync(STORE, JSON.stringify(store)); } catch {}
}

const clients = new Set();
function emit(e) {
  e.id = ++store.seq;
  e.ts = new Date().toISOString();
  store.logs.push(e);
  if (store.logs.length > 1000) store.logs = store.logs.slice(-1000);
  persist();
  const data = `data: ${JSON.stringify(e)}\n\n`;
  for (const res of clients) { try { res.write(data); } catch {} }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let spawnN = 0;
const approvals = new Map(); // runId -> resolve(ok)
let runN = 0;

async function runSim(goal) {
  const runId = "r" + Date.now().toString(36) + (runN++);
  const cfg = store.config, g = cfg.guard;
  const prof = cfg.profiles.find((p) => p.id === cfg.active) || cfg.profiles[0];
  const sup = cfg.supervisor || { skills: [], tools: [], mcps: [] };
  const E = (dir, s, t, type, payload) =>
    emit({ dir, source: s, target: t, type, payload: String(payload).slice(0, 2000), runId });
  E("IN", "user", "supervisor", "user_message", goal);
  E("INTERNAL", "supervisor", "supervisor", "thinking", `parse intent · profile ${prof.name} (${prof.domain})`);
  if (sup.skills.length || sup.tools.length || sup.mcps.length) {
    E("INTERNAL", "supervisor", "supervisor", "thinking",
      `supervisor config · skills=[${(sup.skills || []).join(", ")}] · tools=[${(sup.tools || []).join(", ")}] · mcps=[${(sup.mcps || []).join(", ")}]`);
  }
  E("INTERNAL", "supervisor", "supervisor", "policy",
    `guardrails: maxSteps=${g.maxSteps} timeout=${g.timeoutS}s costCap=$${g.costCap} approval=${g.approval ? "ON" : "OFF"}`);
  await sleep(420);
  const NEEDS = [
    ["research", "read_context", "3 patterns for request"],
    ["code", "draft_change", "solution outline"],
    ["exec", "exec[" + mcpTools().join("|") + "]", "scan + fetch"],
    ["review", "review_diff", "risks + correctness"],
  ];
  E("INTERNAL", "supervisor", "supervisor", "thinking", "plan: " + NEEDS.map((n) => n[0]).join("→"));
  let steps = 0;
  const spawned = [];
  for (const [cap, tool, arg] of NEEDS) {
    if (steps >= g.maxSteps) {
      E("INTERNAL", "supervisor", "supervisor", "thinking", `maxSteps hit (${g.maxSteps}) — truncating plan`);
      break;
    }
    const skill = cfg.skills.find((s) => s.on && s.cap === cap);
    let agent = skill ? skill.id : null;
    if (!agent) {
      spawnN++;
      agent = `spawn-${cap}-${spawnN}`;
      spawned.push(agent);
      E("OUT", "supervisor", "system", "agent_spawned",
        JSON.stringify({ id: agent, cap, tools: tool, budget: 3, parent: cap }));
    }
    const agentSkills = skill && Array.isArray(skill.skills) && skill.skills.length ? skill.skills.join(", ") : "general";
    const agentTools = skill && Array.isArray(skill.tools) && skill.tools.length ? skill.tools.join(", ") : tool;
    const agentMcps = skill && Array.isArray(skill.mcps) && skill.mcps.length ? skill.mcps.join(", ") : "local";
    E("OUT", "supervisor", agent, "task_assign", `${tool}: ${arg} · [skills: ${agentSkills} | tools: ${agentTools} | mcps: ${agentMcps}]`);
    await sleep(600);
    steps++;
    E("IN", agent, "supervisor", "task_result", `${agent} ok · ${arg} · ${goal.slice(0, 44)}`);
  }
  E("INTERNAL", "supervisor", "supervisor", "thinking", "synthesize + compose");
  await sleep(500);
  const f = `[${prof.name}] merged results for "${goal.slice(0, 64)}": context in, change drafted, tool signals captured, review signed off.`;
  if (g.approval) {
    E("OUT", "supervisor", "user", "approval_needed", f);
    const ok = await new Promise((res) => approvals.set(runId, res));
    if (!ok) {
      E("INTERNAL", "user", "supervisor", "approval_denied", "final withheld by human");
      spawned.forEach((id) => E("OUT", "supervisor", "system", "agent_retired", id + " · task complete"));
      return;
    }
    E("INTERNAL", "user", "supervisor", "approval_granted", "final released");
  }
  E("OUT", "supervisor", "user", "final_answer", f);
  spawned.forEach((id) => E("OUT", "supervisor", "system", "agent_retired", id + " · task complete"));
}
function mcpTools() {
  const t = store.config.mcps.filter((m) => m.on).flatMap((m) => m.tools);
  return t.length ? t : ["built-in"];
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function body(req) {
  return new Promise((res, rej) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on("end", () => { try { res(s ? JSON.parse(s) : {}); } catch { rej(new Error("bad json")); } });
  });
}
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (u.pathname === "/api/health") return json(res, 200, { ok: true });
    if (u.pathname === "/api/logs" && req.method === "GET") {
      const limit = Math.min(1000, +(u.searchParams.get("limit") || 300));
      return json(res, 200, { logs: store.logs.slice(-limit) });
    }
    if (u.pathname === "/api/logs" && req.method === "DELETE") {
      store.logs = []; persist();
      emit({ dir: "INTERNAL", source: "system", target: "system", type: "config", payload: "log cleared" });
      return json(res, 200, { ok: true });
    }
    if (u.pathname === "/api/config" && req.method === "GET") return json(res, 200, store.config);
    if (u.pathname === "/api/logs" && req.method === "POST") {
      const b = await body(req);
      if (!b.dir || !b.source || !b.target || !b.type) return json(res, 400, { error: "bad event" });
      emit({ dir: String(b.dir), source: String(b.source), target: String(b.target), type: String(b.type), payload: String(b.payload || "").slice(0, 2000) });
      return json(res, 201, { ok: true });
    }
    if (u.pathname === "/api/config" && req.method === "PUT") {
      const c = await body(req);
      if (!c || !Array.isArray(c.profiles) || !Array.isArray(c.skills)) return json(res, 400, { error: "bad config" });
      store.config = c; persist();
      emit({ dir: "INTERNAL", source: "system", target: "system", type: "config", payload: "config updated" });
      return json(res, 200, store.config);
    }
    if (u.pathname === "/api/runs" && req.method === "POST") {
      const b = await body(req);
      const goal = (b.goal || "").trim();
      if (!goal) return json(res, 400, { error: "goal required" });
      const runId = "r" + Date.now().toString(36) + "-" + runN;
      runSim(goal);
      return json(res, 202, { runId, status: "started" });
    }
    const m = u.pathname.match(/^\/api\/runs\/([^/]+)\/approve$/);
    if (m && req.method === "POST") {
      const b = await body(req);
      const fn = approvals.get(m[1]);
      if (!fn) return json(res, 404, { error: "no pending approval" });
      approvals.delete(m[1]);
      fn(!!b.ok);
      return json(res, 200, { ok: true });
    }
    if (u.pathname === "/api/stream" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      const beat = setInterval(() => { try { res.write(": beat\n\n"); } catch {} }, 25000);
      req.on("close", () => { clearInterval(beat); clients.delete(res); });
      return;
    }
    // static
    let p = u.pathname === "/" ? "/index.html" : u.pathname;
    const file = path.normalize(path.join(PUB, p));
    if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
      return json(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`harness server on http://localhost:${PORT}`));
