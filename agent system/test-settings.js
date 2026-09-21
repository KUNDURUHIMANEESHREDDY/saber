// Self-check test for settings API, supervisor, and agent config
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const storePath = path.join(__dirname, "store.json");
const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
const cfg = raw.config;

// 1. Assert supervisor config structure and distinct profile skills
assert(cfg.supervisor, "config must contain supervisor");
assert(Array.isArray(cfg.supervisor.skills), "supervisor must have skills array");
assert(Array.isArray(cfg.supervisor.tools), "supervisor must have tools array");
assert(Array.isArray(cfg.supervisor.mcps), "supervisor must have mcps array");
assert(cfg.supervisor.skills.length > 0, "supervisor must have initial skills");
assert(cfg.supervisor.tools.length > 0, "supervisor must have initial tools");
assert(cfg.supervisor.mcps.length > 0, "supervisor must have initial mcps");

assert(Array.isArray(cfg.profiles), "config must contain supervisor profiles");
assert(cfg.profiles.length >= 2, "must have multiple supervisor profiles");
cfg.profiles.forEach((p) => {
  assert(p.id && p.name && p.domain, `profile must have id, name, domain: ${p.id}`);
  assert(Array.isArray(p.skills) && p.skills.length > 0, `profile ${p.id} must have distinct skills`);
  assert(Array.isArray(p.tools) && p.tools.length > 0, `profile ${p.id} must have distinct tools`);
});

// Verify different supervisor profiles have different skills
const generalistProf = cfg.profiles.find((p) => p.id === "generalist");
const coderProf = cfg.profiles.find((p) => p.id === "coder");
assert(generalistProf && coderProf, "must have generalist and coder supervisor profiles");
assert(
  JSON.stringify(generalistProf.skills) !== JSON.stringify(coderProf.skills),
  "generalist and coder supervisors must have different skills"
);

// 2. Assert worker agents structure and distinct specialized agent skills
assert(Array.isArray(cfg.skills), "config must contain skills/agents array");
assert(cfg.skills.length >= 4, "must have at least 4 worker agents");
cfg.skills.forEach((agent) => {
  assert(agent.id, "agent must have id");
  assert(Array.isArray(agent.skills) && agent.skills.length > 0, `agent ${agent.id} must have skills array`);
  assert(Array.isArray(agent.tools) && agent.tools.length > 0, `agent ${agent.id} must have tools array`);
  assert(Array.isArray(agent.mcps), `agent ${agent.id} must have mcps array`);
});

// Verify distinct agents have distinct skills tailored to capability
const researcher = cfg.skills.find((a) => a.id === "researcher");
const coder = cfg.skills.find((a) => a.id === "coder");
const executor = cfg.skills.find((a) => a.id === "tools");
const critic = cfg.skills.find((a) => a.id === "critic");
assert(researcher && coder && executor && critic, "must have all key worker agents");
assert(researcher.skills.some((s) => s.includes("search") || s.includes("extraction")), "researcher must have research skills");
assert(coder.skills.some((s) => s.includes("javascript") || s.includes("python") || s.includes("code")), "coder must have code skills");
assert(executor.skills.some((s) => s.includes("shell") || s.includes("docker") || s.includes("file")), "executor must have execution skills");
assert(critic.skills.some((s) => s.includes("review") || s.includes("audit") || s.includes("validation")), "critic must have review skills");
assert(JSON.stringify(researcher.skills) !== JSON.stringify(coder.skills), "researcher and coder must have different skills");

// 3. Assert MCP catalog
assert(Array.isArray(cfg.mcps), "config must contain mcps array");
cfg.mcps.forEach((mcp) => {
  assert(mcp.id && mcp.name, "mcp must have id and name");
  assert(Array.isArray(mcp.tools), "mcp must have tools array");
});

// 4. Assert layout stability rules in public/index.html for logs sidebar
const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
assert(html.includes("flex-shrink:0"), "Side headers or controls must enforce flex-shrink:0");
assert(html.includes(".log-list{flex:1 1 0;min-height:0;overflow-y:auto"), "log-list must be scrollable flex child");

// 5. Assert models catalog and configuration
assert(Array.isArray(cfg.models), "config must contain models array");
assert(cfg.models.length > 0, "config must contain initial models");
cfg.models.forEach((model) => {
  assert(model.id && model.name && model.provider, `model must have id, name, and provider: ${JSON.stringify(model)}`);
  assert(typeof model.on === "boolean", `model ${model.id} must have boolean on status`);
});
assert(cfg.models.some((m) => m.default), "must have at least one default model");

// 6. Assert models UI elements in public/index.html and overlord.js
assert(html.includes('data-sub="models"'), "settings nav must contain models button");
assert(html.includes('id="pane-models"'), "settings must contain pane-models container");
assert(html.includes('id="defaultModelSelect"'), "settings must contain defaultModelSelect dropdown");
assert(html.includes('id="modelsRegistryList"'), "settings must contain modelsRegistryList container");
assert(html.includes('id="newModelBtn"'), "settings must contain newModelBtn");

const js = fs.readFileSync(path.join(__dirname, "public", "overlord.js"), "utf8");
assert(js.includes("renderModelsPane"), "overlord.js must implement renderModelsPane");
assert(js.includes("syncComposerModels"), "overlord.js must implement syncComposerModels");

// 7. Assert valid JS syntax in public/overlord.js
const { execSync } = require("child_process");
execSync("node -c public/overlord.js", { cwd: __dirname });

// 8. Assert Local Skills Library & Marketplace functionality
assert(html.includes('data-marketfilter="local"'), "marketplace must contain local library filter");
assert(html.includes('data-marketfilter="design"'), "marketplace must contain design filter");
assert(html.includes('data-marketfilter="engineering"'), "marketplace must contain engineering filter");
assert(html.includes('data-marketfilter="git"'), "marketplace must contain git filter");
assert(js.includes("loadSkillsLibrary"), "overlord.js must implement loadSkillsLibrary");
assert(js.includes("market-assign-select"), "overlord.js must implement market-assign-select role assignment");
assert(js.includes("data-unassignskill"), "overlord.js must implement unassign skill");

// Assert server.js exports or implements loadLocalSkills
const srvCode = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
assert(srvCode.includes("loadLocalSkills"), "server.js must implement loadLocalSkills");
assert(srvCode.includes('"/api/skills/library"'), "server.js must expose /api/skills/library");
assert(srvCode.includes('"/api/skills/assign"'), "server.js must expose /api/skills/assign");
assert(srvCode.includes('"/api/skills/unassign"'), "server.js must expose /api/skills/unassign");

console.log("All settings, models, layout, and skills marketplace assertions passed successfully.");
