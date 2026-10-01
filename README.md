# Saber

A multi-agent supervision harness with a skills marketplace. A supervisor agent decomposes an incoming task, dispatches specialists, and streams their work back — with per-agent profiles, capabilities, tool access, and MCP servers all configurable at runtime.

Zero runtime dependencies: Node builtins only, no npm install.

---

## Why

Most multi-agent demos hardwire a fixed crew into the code. Change a tool, or add an agent, and you're editing source and restarting.

Saber treats agents, skills, tools, and MCP servers as **configuration**. Profiles, capability sets, tool grants, and model bindings all live in a single store, editable from the UI, and the supervisor reads them at dispatch time.

---

## Architecture

**Supervisor + specialists.** The supervisor handles intent parsing, task decomposition, synthesis, and conflict resolution. Specialists do the domain work under it.

**Profiles** are role templates — Generalist, Code Lead, Security Lead, Research Lead — each declaring its skills, tools, and which MCP servers it may reach.

**Capabilities** are narrower and stackable — a single agent can hold `research` and `code` capabilities at once, merging both skill sets.

Default crew:

| Agent | Capabilities | Notable skills |
|---|---|---|
| **Web Researcher** | research | web-search, content-extraction, summarization, source-verification, fact-checking |
| **Code Engineer** | code | javascript, python, refactoring, fix-ci, syntax-check, run-commands |
| **System Executor** | exec | shell-exec, file-io, docker, process-management, environment-setup |
| **Quality Critic** | review | diff-review, security-audit, adversarial-testing, validation, lint |
| **Frontend Designer** | custom | frontend-design, ui-ux-pro-max, shadcn, canvas-design, theme-factory |

---

## Skills library

32 skill packs in `.agents/skills/`, each a self-contained bundle of instructions, scripts, and references. Lockfile at `.agents/skills.json`.

The **critic** is the deliberate design choice here: a dedicated adversarial reviewer with diff-review and security-audit capabilities, kept separate from the agents whose work it checks. Same reason RedOS separates evidence verification from attack execution — an agent grading its own work isn't verification.

---

## MCP servers

| Server | Tools |
|---|---|
| `local` | fetch, exec, write |
| `github` | pull_request, issue_read, commit |
| `filesystem` | read_file, write_file, list_dir |

Granted per agent. A profile that can't reach `github` cannot create a PR — the boundary is declarative, not enforced by hoping the model behaves.

---

## Running it

```bash
git clone https://github.com/KUNDURUHIMANEESHREDDY/saber.git
cd saber
node server.js
```

Open `http://localhost:3000`. Set `PORT` to change the port.

Model routing goes through an Ollama endpoint (configurable) with a mock fallback for offline runs.

### API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | liveness |
| `GET` | `/api/config` | current profiles, agents, skills, models |
| `PUT` | `/api/config` | update configuration at runtime |
| `POST` | `/api/runs` | start a supervised run |
| `GET` | `/api/stream` | SSE stream of run events |
| `GET` `DELETE` `POST` | `/api/logs` | read, clear, append run logs |

---

## UI

- `index.html` — main console
- `run.html` — run execution view
- `logs.html` — log inspection
- `overlord-screenshot.png`, `overlord-settings-models.png`, `supervisor-agent-skills.png`, `marketplace-skills.png` — screenshots

---

## Status

Active development. Configuration is hot-reloadable; agent profiles are the intended extension point.

---

## License

MIT — see [`LICENSE`](LICENSE).

---

## Related

This supervisor architecture is later merged into [`agent-os`](https://github.com/KUNDURUHIMANEESHREDDY/agent-os) alongside the LoomEngine and DataOS kernel.