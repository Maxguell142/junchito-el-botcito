---
name: token-saver
description: >-
  Reduce repeated investigation and token use while working on QUANTUM FX in BOT_VPN.
  Use for project questions, code changes, wiki maintenance, or when the user asks to
  save context or tokens. Start from this skill and inspect only the relevant source.
---

# QUANTUM FX project context

Use this skill as the compact entry point. Do not reread the whole repository by default.

## Verified project facts

- Product: local multi-bot futures dashboard and simulation project, focused on MNQ/NQ and ES.
- The app has two independent services sharing SQLite: Node.js 22.13+ / Express 5 on port 3008 (primary UI), and optional Python / FastAPI on port 8000. Their APIs differ; verify the relevant server before changing an endpoint.
- Frontend: plain HTML/CSS/JS in `public/`; Node dependencies are Express and `ws`. Node uses built-in `node:sqlite`; Python uses `sqlite3`.
- Execution is `SIMULATED` / historical CSV analysis. No live broker connection, live market feed, or real order execution is implemented. Treat broker and prop-firm documents as design/reference material unless code proves otherwise.
- `BOT_VPN/` is the project root and Obsidian vault. `AGENTS.md` defines wiki workflow. `raw/` is immutable source material; `wiki/` is maintained synthesis.
- Keep credentials and secrets out of source, wiki, logs, and output.

## Fast navigation

- Current stack and verified behavior: `wiki/stack-and-health.md`.
- Setup and service differences: `README.md`.
- Wiki navigation: `wiki/index.md`.
- Wiki maintenance rules: `AGENTS.md`.
- Roadmap: `PENDIENTES_Y_MEJORAS.md` and `IMPLEMENTATION_PLAN.md`.
- Node server and persistence: `server.js`, `database.js`, `migrations/`.
- Python service and persistence: `main.py`, `persistence.py`, `bot_engine.py`, `strategies.py`.
- Browser behavior: `public/app.js`, `public/index.html`, `public/style.css`.
- Tests, only when verification is requested or needed for the change: `tests/`.

## Work efficiently

1. Read this file, then inspect only the relevant source file and its directly related tests/docs. Search symbols before opening large files; read bounded sections where possible.
2. Establish whether a requested feature belongs to Node, FastAPI, the frontend, or the wiki. Do not assume the two APIs are interchangeable.
3. Distinguish implemented, simulated, optional, and planned behavior. Source code and tests outrank conceptual diagrams and wiki claims; update the wiki when implementation facts change.
4. For wiki work, follow `AGENTS.md`: never edit `raw/`; update the relevant wiki page, `wiki/index.md` when adding a page, and append a dated entry to `wiki/log.md` when required by the requested ingest/query/lint workflow.
5. Make the smallest complete change. Avoid dumping full files or repeating the project overview in replies. Summarize changes and verification briefly.
6. Do not run tests unless the user asks for tests/verification or the task requires a specific check to establish correctness.

## Important boundaries

- MNQ tick facts in existing documentation: 0.25 points and $0.50 per tick. Confirm against the source documentation when calculations are part of the task.
- A successful `/healthz` only checks service/database availability; it does not prove broker, feed, proxy, or live trading connectivity.
- Do not describe design diagrams, strategy notes, or broker docs as implemented integrations without code-level evidence.
