// Self-check test for settings API, supervisor, and agent config
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const storePath = path.join(__dirname, "store.json");
const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
const cfg = raw.config;

// 1. Assert supervisor config structure
assert(cfg.supervisor, "config must contain supervisor");
assert(Array.isArray(cfg.supervisor.skills), "supervisor must have skills array");
assert(Array.isArray(cfg.supervisor.tools), "supervisor must have tools array");
assert(Array.isArray(cfg.supervisor.mcps), "supervisor must have mcps array");
assert(cfg.supervisor.skills.length > 0, "supervisor must have initial skills");
assert(cfg.supervisor.tools.length > 0, "supervisor must have initial tools");
assert(cfg.supervisor.mcps.length > 0, "supervisor must have initial mcps");

// 2. Assert worker agents structure
assert(Array.isArray(cfg.skills), "config must contain skills/agents array");
cfg.skills.forEach((agent) => {
  assert(agent.id, "agent must have id");
  assert(Array.isArray(agent.skills), `agent ${agent.id} must have skills array`);
  assert(Array.isArray(agent.tools), `agent ${agent.id} must have tools array`);
  assert(Array.isArray(agent.mcps), `agent ${agent.id} must have mcps array`);
});

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

console.log("All settings and layout assertions passed successfully.");
