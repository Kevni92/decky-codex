# Third-party notices

Decky Codex's own source is MIT licensed. Bundled components retain their licenses.

- OpenAI Codex 0.163.0: Apache-2.0. https://github.com/openai/codex
  Full license: licenses/Codex-Apache-2.0.txt. The native package layout and upstream
  README are preserved under bin/. Individual resources include their own notices.
- The runtime includes Bubblewrap (LGPL-2.1-or-later), ripgrep (MIT/Unlicense),
  and OpenAI code-mode/voice helpers. Voice dependency notices, license texts,
  source descriptions and manifests are preserved in the vendor resource directory.
  Corresponding upstream sources: https://github.com/containers/bubblewrap,
  https://github.com/BurntSushi/ripgrep and https://github.com/openai/codex.
- @decky/api, @decky/ui and @decky/rollup: BSD-3-Clause.
  https://github.com/SteamDeckHomebrew/decky-frontend-lib
- react-markdown and remark-gfm: MIT. https://github.com/remarkjs
- Frontend transitive dependency notices are collected into licenses/frontend.txt
  by the build tooling. React itself is supplied by Steam/Decky at runtime.

The downloadable runtime archive is pinned by SHA-512 in runtime/manifest.json.
File hashes for the installed bundle are included in runtime/installed.json.
