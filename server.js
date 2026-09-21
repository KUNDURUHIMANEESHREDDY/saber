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
      {
        id: "generalist",
        name: "Generalist",
        domain: "general",
        skills: ["intent-parsing", "task-decomposition", "synthesis", "conflict-resolution", "policy-enforcement", "act-on-feedback"],
        tools: ["delegate_task", "request_approval", "inspect_context", "agent_spawn"],
        mcps: ["local"],
      },
      {
        id: "coder",
        name: "Code Lead",
        domain: "software",
        skills: ["architecture-review", "code-review", "task-decomposition", "refactoring-planning", "fix-ci", "ponytail", "generate-run-commands"],
        tools: ["delegate_task", "inspect_context", "review_diff", "agent_spawn", "python_repl"],
        mcps: ["local", "github", "filesystem"],
      },
      {
        id: "security",
        name: "Security Lead",
        domain: "security",
        skills: ["threat-modeling", "security-audit", "adversarial-review", "guardrail-enforcement", "compliance-check"],
        tools: ["delegate_task", "request_approval", "inspect_context", "cancel_run"],
        mcps: ["local", "filesystem"],
      },
      {
        id: "researcher",
        name: "Research Lead",
        domain: "research",
        skills: ["hypothesis-formulation", "source-verification", "fact-checking", "literature-review", "information-synthesis"],
        tools: ["delegate_task", "inspect_context", "agent_spawn", "fetch_url"],
        mcps: ["local", "github"],
      },
    ],
    supervisor: {
      skills: ["intent-parsing", "task-decomposition", "synthesis", "conflict-resolution"],
      tools: ["delegate_task", "request_approval", "inspect_context", "agent_spawn"],
      mcps: ["local"],
    },
    skills: [
      {
        id: "researcher",
        name: "Web Researcher",
        cap: "research",
        skills: ["web-search", "content-extraction", "summarization", "source-verification", "fact-checking"],
        tools: ["read_context", "fetch_url", "search_web", "extract_content"],
        mcps: ["local", "github"],
        on: true,
      },
      {
        id: "coder",
        name: "Code Engineer",
        cap: "code",
        skills: ["javascript", "python", "refactoring", "fix-ci", "ponytail", "generate-run-commands", "syntax-check"],
        tools: ["draft_change", "format_code", "syntax_check", "run_tests"],
        mcps: ["local", "filesystem"],
        on: true,
      },
      {
        id: "tools",
        name: "System Executor",
        cap: "exec",
        skills: ["shell-exec", "file-io", "docker", "troubleshoot", "process-management", "environment-setup"],
        tools: ["exec_cmd", "write_file", "read_file", "kill_process"],
        mcps: ["local", "filesystem"],
        on: true,
      },
      {
        id: "critic",
        name: "Quality Critic",
        cap: "review",
        skills: ["security-audit", "diff-review", "validation", "code-review", "adversarial-testing", "lint"],
        tools: ["review_diff", "verify_contract", "lint", "audit_security"],
        mcps: ["local", "github"],
        on: true,
      },
      {
        id: "designer",
        name: "Frontend Designer",
        cap: "custom",
        skills: ["frontend-design", "web-design-engineer", "ui-ux-pro-max", "shadcn", "canvas-design", "animate", "theme-factory"],
        tools: ["draft_component", "preview_render", "inspect_css", "format_code"],
        mcps: ["local", "filesystem"],
        on: true,
      },
    ],
    mcps: [
      { id: "local", name: "local-tools", tools: ["fetch", "exec", "write"], on: true },
      { id: "github", name: "github-mcp", tools: ["pull_request", "issue_read", "commit"], on: true },
      { id: "filesystem", name: "filesystem-mcp", tools: ["read_file", "write_file", "list_dir"], on: true },
    ],
    models: [
      { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet", provider: "Anthropic", tag: "Recommended", desc: "Hybrid reasoning & deep code execution", context: "200k", on: true, default: true },
      { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", tag: "Flagship", desc: "High-bandwidth multimodal intelligence", context: "128k", on: true, default: false },
      { id: "deepseek-r1", name: "DeepSeek R1", provider: "DeepSeek", tag: "Reasoning", desc: "In-depth mathematical reasoning", context: "64k", on: true, default: false },
      { id: "qwen-2-5-coder", name: "Qwen 2.5 Coder", provider: "Alibaba Cloud / Ollama", tag: "Fast", desc: "Fast open-source code generation", context: "32k", on: true, default: false },
    ],
    providers: { anthropic: "", openai: "", deepseek: "", ollamaUrl: "http://localhost:11434" },
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
    if (!Array.isArray(store.config.models) || !store.config.models.length) store.config.models = defCfg().models;
    if (!store.config.providers) store.config.providers = defCfg().providers;
    if (Array.isArray(store.config.profiles)) {
      store.config.profiles.forEach((p) => {
        if (!Array.isArray(p.skills) || !p.skills.length) {
          const match = defCfg().profiles.find((x) => x.id === p.id);
          p.skills = match ? match.skills : ["intent-parsing", "task-decomposition", "synthesis"];
        }
        if (!Array.isArray(p.tools) || !p.tools.length) {
          const match = defCfg().profiles.find((x) => x.id === p.id);
          p.tools = match ? match.tools : ["delegate_task", "request_approval", "inspect_context", "agent_spawn"];
        }
        if (!Array.isArray(p.mcps) || !p.mcps.length) p.mcps = ["local"];
      });
    }
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
  const supSkills = (prof && Array.isArray(prof.skills) && prof.skills.length) ? prof.skills : (cfg.supervisor ? cfg.supervisor.skills : []);
  const supTools = (prof && Array.isArray(prof.tools) && prof.tools.length) ? prof.tools : (cfg.supervisor ? cfg.supervisor.tools : []);
  const supMcps = (prof && Array.isArray(prof.mcps) && prof.mcps.length) ? prof.mcps : (cfg.supervisor ? cfg.supervisor.mcps : []);

  const E = (dir, s, t, type, payload) =>
    emit({ dir, source: s, target: t, type, payload: String(payload).slice(0, 2000), runId });
  E("IN", "user", "supervisor", "user_message", goal);
  E("INTERNAL", "supervisor", "supervisor", "thinking", `parse intent · profile ${prof.name} (${prof.domain})`);
  if (supSkills.length || supTools.length || supMcps.length) {
    E("INTERNAL", "supervisor", "supervisor", "thinking",
      `supervisor config [${prof.name}] · skills=[${supSkills.join(", ")}] · tools=[${supTools.join(", ")}] · mcps=[${supMcps.join(", ")}]`);
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

function getSkillCategory(id) {
  if (["frontend-design", "design-taste-frontend", "ui-ux-pro-max", "shadcn", "canvas-design", "animate", "theme-factory", "web-design-engineer"].includes(id)) {
    return { category: "Design & Frontend", icon: "ti-palette", color: "var(--blue)" };
  }
  if (["code-review", "troubleshoot", "fix-ci", "ponytail", "generate-run-commands"].includes(id)) {
    return { category: "Engineering & QA", icon: "ti-code", color: "var(--green)" };
  }
  if (["commit", "create-pr", "create-draft-pr", "update-pr", "merge", "sync", "sync-upstream", "update-skills"].includes(id)) {
    return { category: "Git & Automation", icon: "ti-git-branch", color: "var(--violet)" };
  }
  if (["algorithmic-art"].includes(id)) {
    return { category: "Generative Art", icon: "ti-sparkles", color: "#d97706" };
  }
  return { category: "General Agent", icon: "ti-tool", color: "var(--text)" };
}

function loadLocalSkills() {
  const dir = path.join(__dirname, ".agents", "skills");
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const result = [];
  const cfg = store.config || {};

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(dir, entry.name, "SKILL.md");
    let name = entry.name;
    let description = "Specialized AI skill package with operational prompts and constraints.";

    if (fs.existsSync(skillPath)) {
      try {
        const content = fs.readFileSync(skillPath, "utf8");
        const match = content.match(/^---\s*([\s\S]*?)\s*---/);
        if (match) {
          const rawFm = match[1];
          const nMatch = rawFm.match(/name:\s*(.+)/);
          if (nMatch) name = nMatch[1].trim().replace(/^["\x27]|["\x27]$/g, "");
          const dMatch = rawFm.match(/description:\s*(?:>|\|)?\s*\n?([\s\S]*?)(?=\n[a-z0-9_-]+:|$)/i);
          if (dMatch) {
            description = dMatch[1].replace(/\n+/g, " ").trim().replace(/^["\x27]|["\x27]$/g, "");
          }
        }
      } catch {}
    }

    const cat = getSkillCategory(entry.name);
    const installedIn = [];

    // Check supervisor profiles
    if (Array.isArray(cfg.profiles)) {
      cfg.profiles.forEach((p) => {
        if (Array.isArray(p.skills) && p.skills.includes(entry.name)) {
          installedIn.push({ type: "supervisor", id: p.id, name: `${p.name} (Supervisor)` });
        }
      });
    }
    // Check worker agents
    if (Array.isArray(cfg.skills)) {
      cfg.skills.forEach((a) => {
        if (Array.isArray(a.skills) && a.skills.includes(entry.name)) {
          installedIn.push({ type: "agent", id: a.id, name: `${a.name} (Agent)` });
        }
      });
    }

    result.push({
      id: entry.name,
      name,
      description: description.slice(0, 240),
      category: cat.category,
      icon: cat.icon,
      color: cat.color,
      installedIn,
    });
  }
  return result;
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
    if (u.pathname === "/api/skills/library" && req.method === "GET") {
      return json(res, 200, { skills: loadLocalSkills() });
    }
    if (u.pathname === "/api/skills/assign" && req.method === "POST") {
      const b = await body(req);
      const skillId = String(b.skillId || "").trim();
      const targetType = String(b.targetType || "agent").trim();
      const targetId = String(b.targetId || "").trim();
      if (!skillId || !targetId) return json(res, 400, { error: "skillId and targetId required" });

      if (targetType === "supervisor") {
        const prof = store.config.profiles.find((p) => p.id === targetId);
        if (prof) {
          if (!Array.isArray(prof.skills)) prof.skills = [];
          if (!prof.skills.includes(skillId)) prof.skills.push(skillId);
        }
        if (store.config.supervisor && Array.isArray(store.config.supervisor.skills)) {
          if (!store.config.supervisor.skills.includes(skillId)) store.config.supervisor.skills.push(skillId);
        }
      } else {
        const agent = store.config.skills.find((a) => a.id === targetId);
        if (agent) {
          if (!Array.isArray(agent.skills)) agent.skills = [];
          if (!agent.skills.includes(skillId)) agent.skills.push(skillId);
        }
      }
      persist();
      emit({ dir: "INTERNAL", source: "system", target: "system", type: "config", payload: `skill ${skillId} assigned to ${targetType}:${targetId}` });
      return json(res, 200, { ok: true, config: store.config, library: loadLocalSkills() });
    }
    if (u.pathname === "/api/skills/unassign" && req.method === "POST") {
      const b = await body(req);
      const skillId = String(b.skillId || "").trim();
      const targetType = String(b.targetType || "agent").trim();
      const targetId = String(b.targetId || "").trim();
      if (!skillId || !targetId) return json(res, 400, { error: "skillId and targetId required" });

      if (targetType === "supervisor") {
        const prof = store.config.profiles.find((p) => p.id === targetId);
        if (prof && Array.isArray(prof.skills)) {
          prof.skills = prof.skills.filter((s) => s !== skillId);
        }
        if (store.config.supervisor && Array.isArray(store.config.supervisor.skills)) {
          store.config.supervisor.skills = store.config.supervisor.skills.filter((s) => s !== skillId);
        }
      } else {
        const agent = store.config.skills.find((a) => a.id === targetId);
        if (agent && Array.isArray(agent.skills)) {
          agent.skills = agent.skills.filter((s) => s !== skillId);
        }
      }
      persist();
      emit({ dir: "INTERNAL", source: "system", target: "system", type: "config", payload: `skill ${skillId} unassigned from ${targetType}:${targetId}` });
      return json(res, 200, { ok: true, config: store.config, library: loadLocalSkills() });
    }
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
