---
name: token-saver
description: >-
  Save context and avoid repeated investigation on QUANTUM FX / INVICTUS TRADING OS.
  Use for project questions, code changes, architecture reviews, or wiki work.
---

# QUANTUM FX compact project map

Read this first; do not scan the whole repository by default.

## Verified facts

- App lives in `BOT_VPN/`; `BOT_VPN/AGENTS.md` defines wiki maintenance.
- Node.js 22.13+ / Express 5 serves the vanilla JS dashboard and API on port 3008. Optional Python / FastAPI runs separately on port 8000. Both use SQLite but their APIs differ.
- Trading/order execution remains simulated; the CSV analysis is historical. No live broker execution or real VPN-per-bot orchestration is established.
- The current working tree adds a Node market-data module (`BOT_VPN/src/marketData.js`) for chart candles, with Yahoo/Finnhub/Alpha Vantage requests and synthetic fallback. This is separate from the simulated trading price and does not prove a live CME feed.
- The global chart still uses `GET /api/market/candles` (simulated in-memory series); bot-specific charts call authenticated `GET /api/bot/:botId/candles`, with symbols from a static JSON map and a default of MNQ. Browser refresh is polling, about every 60 seconds, not a market stream.
- Finnhub and Alpha Vantage map futures symbols to QQQ/SPY, which are ETF prices, not MNQ/NQ/ES futures prices. The UI does not clearly surface provider/fallback state. Do not use these chart values as execution prices.
- `tests/marketData.test.js` asks for provider `synthetic`, but that is not an explicit mode in `getCandles`; unknown providers try Yahoo first. Treat that test as potentially network-dependent until fixed.
- `BOT_VPN/.cursorrules` is Cursor guidance. `BOT_VPN/types/financial_types.ts` is not wired into JavaScript/Python or checked by a TypeScript build; treat it as a draft/reference until aligned with actual API and database contracts.
- Keep credentials out of prompts, source, wiki, logs, and output. Never put secrets in MCP or dotenv tools exposed to an assistant.

## Find the relevant source

- Verified stack and limits: `BOT_VPN/wiki/stack-and-health.md`; setup: `BOT_VPN/README.md`.
- Node service / SQLite: `BOT_VPN/server.js`, `BOT_VPN/database.js`, `BOT_VPN/migrations/`.
- Python service: `BOT_VPN/main.py`, `BOT_VPN/persistence.py`, `BOT_VPN/bot_engine.py`, `BOT_VPN/strategies.py`.
- UI: `BOT_VPN/public/app.js`, `index.html`, `style.css`.
- Existing tests: `BOT_VPN/tests/` (run only when requested or needed).
- Market data connector notes: `BOT_VPN/wiki/connectors/market-data-providers.md`.

## Efficient workflow

1. Search symbols with `rg`; open only the target and directly related code/docs/tests.
2. Identify which service owns the requested behavior; never assume Node and FastAPI contracts match.
3. Treat source and tests as evidence; label features implemented, simulated, optional, or planned.
4. For wiki edits, preserve `raw/`, follow `BOT_VPN/AGENTS.md`, update the index for new pages, and append log entries when its workflow requires them.
5. Make the smallest complete change; keep explanations and diffs concise. Do not install a framework or MCP server without a concrete missing capability.

## Local tools and architecture choices

- Repository search and local commands are already available in Codex; a separate ripgrep or Desktop Commander MCP is not needed for this workspace.
- Use web search for current official docs when a task needs them. Do not add Context7/Valyu just for general development.
- FastAPI is an existing optional service, not automatically the definitive trading engine. Next.js/Tailwind and physical OpenVPN/WireGuard orchestration are not current runtime dependencies; avoid migrations absent a specific requirement.
- Do not treat TypeScript interfaces as enforced contracts until a compiler/build or generated schema validates them against the actual Python/Node/SQLite models.
