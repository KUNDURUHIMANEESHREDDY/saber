# SABER — OVERLORD Agent Console

A supervisor-style multi-agent console: submit a goal, and a chain of LLM calls plans the work, dispatches it to
specialist "agents", runs each in sequence, and synthesises a report — streamed live to the browser over SSE.

The entire server is **669 lines of Node.js with zero dependencies** (Node builtins only), plus a 2,223-line
vanilla-JS frontend.

> ⚠️ **Prototype, with real security problems.** 4 commits, all from one afternoon. **A live API key is committed to
> this public repository** — see [Security](#security-issues). Large parts of the repo are mockups that the server
> never serves. Read [What is real vs. what is a mockup](#what-is-real-vs-what-is-a-mockup) first.

---

## Quick start

There is no `package.json`, no lockfile, and no install step.

```bash
git clone https://github.com/KUNDURUHIMANEESHREDDY/saber.git
cd saber
node server.js
```

Open **<http://localhost:3000>**. Requires **Node 18+** (uses global `fetch` and `AbortSignal.timeout`).

Override the port with `PORT=8080 node server.js` (`$env:PORT=8080; node server.js` in PowerShell).

Run the self-check:

```bash
node test-settings.js
# All settings, models, layout, and skills marketplace assertions passed successfully.
```

---

## How a run works

`POST /api/runs` kicks off a fire-and-forget `runSim()` (not awaited, no `.catch()` — an unhandled rejection will
crash Node). The sequence:

1. **Classify** the goal with a regex — does it contain `build|create|make|write|develop|design|refactor|audit|scrape|app|tool|team|code|api|pipeline`?
2. **Plan** — one LLM call producing a numbered list, capped at 8 steps.
3. **Dispatch** — one LLM call assigning work in the form `agent-id: instruction`.
4. **Execute** — one further LLM call per assigned agent, prompted as that specialist.
5. **Synthesise** — a final LLM call fed the specialists' "deliverables".

That is **4–8 sequential round-trips per run**. Events stream to the UI via SSE at `/api/stream` and are appended to
`store.json`, capped at 1,000 entries.

### There is no tool execution layer

The system **never writes files, never runs shell commands, and never invokes a real tool.** The `tools` and `mcps`
arrays in config are pure metadata. `draft_change`, `format_code`, and `syntax_check` are strings interpolated into
prompts — nothing calls them.

---

## LLM configuration

Config lives in `store.json` → `config`, edited through the Settings UI. **The only environment variable is
`PORT`.**

There are three call paths, in order:

| # | Target | Config field | Notes |
|---|---|---|---|
| 1 | OpenAI-compatible router | `routerUrl` + `routerKey` | `POST {routerUrl}/chat/completions`, 35s timeout. Tries candidate models in order. |
| 2 | Ollama | `ollamaUrl` | `POST {ollamaUrl}/api/chat`, 20s timeout, no auth |
| 3 | Nothing | — | Returns `null`; the UI shows a canned greeting |

> ### ⚠️ The Anthropic / OpenAI / DeepSeek key fields do nothing
>
> `providers.anthropic`, `providers.openai`, and `providers.deepseek` are rendered in the Settings UI and persisted
> to `store.json`, but **`callLLM()` never reads them**. Every call goes to the router or Ollama. Pasting a real
> `sk-ant-…` key will have no effect and will sit in plaintext in a tracked file.

**There is no offline or mock mode.** Without a reachable router or Ollama, runs degrade to a static greeting.

`config.models` (`claude-3-7-sonnet`, `gpt-4o`, `deepseek-r1`, `qwen-2-5-coder`) is **display metadata only** — the
`provider` label does not determine where the call goes.

---

## Skill marketplace

32 skills live in `.agents/skills/<name>/SKILL.md` with YAML frontmatter:

```markdown
---
name: coder
description: Software development supervisor specialized in architecture review, ...
license: MIT
---
```

The marketplace UI scans that directory, regex-extracts `name` and `description`, and assigns a category from a
hardcoded ID list. `GET /api/skills/library` returns them.

> **Skills are displayed, never used.** The server reads `SKILL.md` *only* to pull out those two frontmatter
> fields. The body of every skill is **never sent to a model**. Roughly 23 of the 32 are vendored verbatim from
> other projects (`anthropics/skills`, `ConardLi/garden-skills`, `emilkowalski/skills`, `shadcn-ui/ui`, and others);
> the rest are local prompt stubs.

**"Install" downloads nothing.** `installCustomPackage()` derives an ID from the last path segment of whatever you
paste and pushes that string into `config.supervisor.skills`. There is no clone, no fetch, no verification.

The 26 entries in the hardcoded client-side `MARKETPLACE_CATALOG` have **invented sources** such as
`community/web-scraper` and `ecc/react/patterns`. There is no registry behind them.

`skills-lock.json` pins 9 skills with SHA-256 hashes and real GitHub sources — but **nothing in the codebase reads
that file**, and 23 of the 32 local skills are absent from it.

---

## What is real vs. what is a mockup

This repository contains **two separate applications**, and only one is live.

| | **App A — OVERLORD** (live) | **App B — "harness"** (mock) |
|---|---|---|
| Server | `server.js` | none |
| UI | `public/index.html` + `public/overlord.js` | `index.html`, `run.html`, `logs.html` |
| Backend | real HTTP + SSE + LLM calls | **none** |
| State | `store.json` on disk | `localStorage` only |
| Reachable? | **Yes** — <http://localhost:3000> | **No — returns HTTP 404** |

The static handler only serves from `public/`, so the root `index.html`, `run.html`, `logs.html`, and everything
under `demos/` return `{"error":"not found"}` when opened over HTTP. They work only via `file://`.

`demos/` (10 files) are **100% client-side fakes** — no `fetch`, no `/api/`, all logs in `localStorage` plus a
`BroadcastChannel`. They simulate agent runs with `setTimeout` and canned text.

`public/team-app.html` exists because `server.js` **hardcodes** a "Live Application Deployed" link for goals matching
`/team|free|availability/i`. It is the pre-built output for one keyword match, not an app generator.

### Dead code

- `config.guard` (`maxSteps`, `timeoutS`, `costCap`, `approval`) is **never read by `server.js`** — guardrails do
  not exist in the live path. Only the mock root `index.html` honors it.
- The human-approval gate is unreachable: the `approvals` Map has `.get()` and `.delete()` but **no `.set()`**, so
  `POST /api/runs/:id/approve` always returns `404 {"error":"no pending approval"}`. The client swallows the error.
- `mcpTools()` is defined and never called. `spawnN` is assigned and never used.
- **`agent system/` is a stale self-copy** — a `cp -r .` of an older tree, committed, that duplicates roughly half
  the repository and contains a second `server.js` that will also try to bind port 3000 with a stale `store.json`.

---

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | `{ok:true}` |
| GET | `/api/logs?limit=N` | Last N events (max 1000) |
| DELETE | `/api/logs` | Clear log |
| POST | `/api/logs` | Append one event |
| GET | `/api/config` | Full config **including provider keys — no auth** |
| PUT | `/api/config` | Replace config wholesale |
| GET | `/api/skills/library` | The 32 local skills |
| POST | `/api/skills/assign` / `/unassign` | Attach or detach a skill |
| POST | `/api/providers/test-ollama` | Probe `GET {url}/api/tags`, 2.5s timeout |
| POST | `/api/providers/test-router` | Probe `GET {url}/models`, 3.5s timeout |
| POST | `/api/providers/sync-router-models` | Import router model list into config |
| POST | `/api/runs` | Start a run |
| POST | `/api/runs/:id/approve` | **Dead — approvals map is never populated** |
| GET | `/api/stream` | SSE, 25s heartbeat |

---

## Security issues

**1. A live API key was committed.** A router key was hardcoded at `server.js:116` and `server.js:133`, and
present in `store.json` and the stale `agent system/` copy. All four are removed in `f18d180`. It was published in
a public repository, so **rotate that key regardless** — removing it from HEAD does not remove it from git history.

**2. `GET /api/config` returns every provider key with no authentication**, and the server binds all interfaces
(no host argument on `listen()`).

**3. `store.json` is tracked and rewritten on every single event**, and there is **no `.gitignore`**. It holds the
API key plus up to 1,000 user prompts and responses in plaintext. Anyone who runs this and commits commits their
conversation history and key.

**4. Not fully offline.** `public/index.html` loads Tabler icons from `cdn.jsdelivr.net`. All icons break without
internet access — despite `demos/index.html` advertising "No backend, no CDN".

The path-traversal guard is correct (`server.js:660`), and the request body is capped at 1 MB.

---

## Tests

One file, no framework, no runner: `test-settings.js` (110 lines). It asserts on the shape of `store.json`
config, greps `public/index.html` for required CSS selectors and DOM ids, syntax-checks `overlord.js` via
`node -c`, and does string-presence checks on `server.js` source.

It **never starts the server, never hits an endpoint, and never exercises `callLLM` or `runSim`.** The source-grep
assertions would pass against empty stubs.

A stale duplicate exists at `agent system/test-settings.js`.

---

## CI

**None.** `.github/` contains only `copilot-instructions.md` — no workflows directory. `test-settings.js` is never
run automatically.

That instructions file defines a "lazy senior developer" convention: a seven-rung ladder of whether code needs
building at all, a mandate to leave one runnable assert-based check behind any non-trivial logic, and a requirement
to mark shortcuts with `// ponytail:` comments. There is exactly one such comment in the codebase
(`server.js:127`, a hand-rolled store migration rather than schema versioning).

---

## Known gaps

- No `package.json`, lockfile, `.gitignore`, Dockerfile, or `.nvmrc`
- `skills-lock.json` and `.agents/skills.json` are orphaned — nothing reads them
- `runSim()` is unhandled; a rejected promise crashes the process
- `overlord-settings-models.png` is byte-identical to `models-page.png` (same git blob)
- Two unmerged PRs are open, including one on branch `readme` that adds a README and LICENSE. That README contains
  several claims that are inaccurate against `main` — it asserts a mock fallback that does not exist and lists the
  root HTML mocks, which 404, as the UI.

---

## License

No `LICENSE` file on `main`. GitHub reports `license: null`.
