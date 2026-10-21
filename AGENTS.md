# Development instructions

This repository builds Decky Codex, a Steam Deck Gaming Mode plugin. Runtime
instructions belong to `agent/AGENTS.md`, not this developer file.

- Python backend uses the standard library. Frontend uses Decky React and TypeScript.
- Run `npm ci`, `npm run typecheck`, `npm run build` and `python3 -m unittest discover -s tests -v`.
- Run `python3 scripts/prepare_runtime.py`, `python3 scripts/smoke.py` and
  `python3 scripts/package.py` before changing runtime/package handling.
- No real installations, cleanup, root commands or account credentials in tests.
- Keep native Codex read-only. Explicit host commands require UI approval.
- Never log RPC parameters or passwords. Root authentication bypasses model context.
- Preserve the source plan; document deviations and hardware-test limitations.
- Changes use branches and PRs. Main builds publish preview ZIP releases.
