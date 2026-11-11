# Project workspace instructions

- Application and Obsidian vault live in `BOT_VPN/`; read `BOT_VPN/AGENTS.md` for wiki rules.
- For QUANTUM FX work, use `.agents/skills/token-saver/SKILL.md` as the compact project map, then inspect only relevant files.
- Verified runtime: Node/Express dashboard (port 3008) and optional FastAPI service (port 8000), sharing SQLite. They are separate and their APIs differ.
- Frontend is vanilla HTML/CSS/JS. Trading and market data are simulated or historical; do not claim live broker, feed, or VPN integrations without code evidence.
- `BOT_VPN/raw/` is immutable. Never put credentials or secrets in source, docs, logs, or assistant context.
