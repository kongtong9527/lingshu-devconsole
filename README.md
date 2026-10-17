# Lingshu DevConsole

[![CI](https://github.com/kongtong9527/lingshu-devconsole/actions/workflows/ci.yml/badge.svg)](https://github.com/kongtong9527/lingshu-devconsole/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.17-3c873a.svg)](https://nodejs.org)

**English** · [简体中文](README.zh-CN.md)

> [!IMPORTANT]
> **Lingshu (灵枢) DevConsole is the web debug console of a plugin-driven content-aggregation runtime.** It
> runs `.plugin.js` files through the Lingshu runtime (`lingshu-runtime`) and gives you a visual way to
> pick a plugin, run an action, inspect the raw JSON, render a preview of the result, and trace the HTTP
> requests a plugin makes.
>
> **This repository contains no content source, no site implementation and no content policy.** It ships the
> console (React front-end + Fastify BFF) and its host-side documentation. There is no bundled plugin and no
> default plugin directory: you must point it at a directory of plugins that you obtained yourself.
>
> **The sandbox is not a security boundary.** Plugins run in the runtime's `node:vm` sandbox, which shares the
> host V8 heap and process; escapes via the prototype chain and dynamic `import()` are known paths. The
> sandbox provides **development-time isolation and dangerous-API blocking**, **not** containment of
> untrusted code. Do not run plugins from sources you do not trust.
>
> **Plugins are third-party.** Every plugin you load is provided by somebody else. This project does not
> provide, host, audit, endorse or take responsibility for plugin content, for the sites a plugin talks to,
> for what it retrieves, or for how you use the output.

## What is in this repository

| Path | What it is |
| --- | --- |
| `src/` | React front-end: run bar, JSON/preview panes, card-DSL preview, filters, account panel, player diagnostics |
| `server/src/` | Fastify BFF: plugin discovery and runs, request tracing, media/image proxying, browser channel, `$lib.ui` bridge over SSE |
| `docs/` | Host-side engineering notes: preview navigation, card DSL rendering, video playback, browser channel, build/type-check notes |
| `AGENTS.md` | Host-side red lines and the documentation index |

Two design points worth knowing before you read the code:

- **Contract types come from the runtime package.** The card-DSL validator (`validateCardDSL`,
  `shouldFallbackCard`) and the contract types are imported from `lingshu-runtime`'s built `dist/`,
  never re-implemented here — one behaviour for all hosts.
- **The plugin directory is always explicit.** The BFF resolves it from the request (`?dir=` /
  `options.dir`), then `LINGSHU_PLUGINS_DIR` (also written by the `--plugins-dir <path>` server flag), then
  `<cwd>/plugins`. There is no fallback to a sibling checkout: with no directory, the plugin list is empty
  and a run reports the tried candidates.

## Requirements

- **Node.js ≥ 18.17** (Node 20 LTS recommended) — the binding constraint is `sharp` 0.33, which the image
  pipeline uses; Vite 5 requires 18 or newer as well.
- npm

## Quick start

```bash
git clone https://github.com/kongtong9527/lingshu-devconsole.git
cd lingshu-devconsole
npm ci                   # if this checkout has no lockfile, use `npm install` instead
npm run build

# Point the console at a plugin directory you obtained yourself (REQUIRED — nothing is bundled):
LINGSHU_PLUGINS_DIR=/path/to/plugins npm run dev
```

> **Cross-repo dependency (`lingshu-runtime`)**: it is consumed as a git dependency until the
> package is published to npm. npm resolves GitHub git dependencies over **ssh** (`ssh://git@github.com/…`),
> which fails on machines without a GitHub SSH key. If `npm ci` stops with
> `Permission denied (publickey)`, map it back to https once:
>
> ```bash
> git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"
> ```
>
> While `kongtong9527/lingshu-runtime` is still private you also need credentials for it (a PAT in the URL
> or an SSH key); once it is public the https mapping above is all you need.


`npm run dev` starts both processes:

- Vite dev server on <http://localhost:5180> — this is what you open in the browser.
- Fastify BFF on `127.0.0.1:5181`; Vite proxies `/api` to it.

Open the page, pick a plugin, pick an action, fill in the parameters and run it. Switch the result pane
between **JSON** and **preview**; the request log lists every HTTP request the plugin made.

### Pointing the console at a plugin directory

The resolver tries, in order: an explicit request parameter (`?dir=` / `options.dir`), then
`LINGSHU_PLUGINS_DIR` (the `--plugins-dir` server flag writes the same variable), then `<cwd>/plugins` —
and reports every candidate it tried when none exists. Four equivalent ways to use that:

```bash
# 1. environment variable (works for dev and for the built server)
LINGSHU_PLUGINS_DIR=/path/to/plugins npm run dev

# 2. server flag
node server/dist/index.js --plugins-dir /path/to/plugins
npm run start -- --plugins-dir /path/to/plugins

# 3. a plugins/ directory inside the working directory (symlinks are fine)
mkdir -p plugins && cp /path/to/plugins/*.plugin.js plugins/

# 4. per request (the front-end passes it when you use the directory field)
curl 'http://127.0.0.1:5181/api/plugins?dir=/path/to/plugins'
```

If none of the candidates exists, the console shows an empty plugin list and a run returns the list of
candidates it tried — it will not silently reach outside the repository.

### Running the built app

```bash
npm run build                                              # type check → BFF compile → web bundle
node server/dist/index.js --plugins-dir /path/to/plugins   # API + SSE on 127.0.0.1:5181
```

The BFF is **API-only** — it does not serve the web bundle. `npm run build:web` writes the front-end to
`dist/`; serve that directory with any static host and route `/api` to the BFF (the Vite dev server does
exactly that in `vite.config.ts`). For local work, `npm run dev` remains the convenient path. `PORT`
overrides the BFF port (default `5181`).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite (5180) + BFF (5181) together, for development |
| `npm run dev:vite` / `npm run dev:server` | The two halves separately |
| `npm run build` | `typecheck` → compile the BFF → bundle the web app |
| `npm run typecheck` | Front-end `tsc --noEmit` + BFF `tsc -p server/tsconfig.json --noEmit` |
| `npm run build:server` / `npm run build:web` | The two build halves separately |
| `npm run start` | Run the built BFF (`server/dist/index.js`) |
| `npm test` | Vitest (jsdom) |

**Type checking is not part of `npm test`.** Vite and Vitest both use esbuild, which does not type-check, so
a wrong contract field can leave the test suite green. `npm run build` (and `npm run typecheck`) is what CI
relies on. Type checking resolves the contract types from the **installed** `lingshu-runtime` package,
so install dependencies before running it.

### Tests and the plugin corpus

Most of the server tests need a plugin directory as corpus. This repository ships none, so those groups
**skip themselves** instead of failing: the resolver logs the candidate paths it tried, and the
corpus-dependent `describe` blocks are skipped as a whole.

`LINGSHU_REQUIRE_PLUGIN_CORPUS=1` turns "corpus missing" into a hard failure. It exists for the upstream
development repository, where the corpus is always present — **do not set it here**, or the suite will fail
by design.

## The runtime dependency

This console imports `lingshu-runtime` for the sandbox, the action dispatch and the card-DSL validator.
While the npm package is unpublished, the dependency is consumed from source (a git dependency pinned to a
release tag, or a built checkout); the contract types are taken from that package's `dist/`, which is built
by `npm run build` inside the runtime repository. Once `lingshu-runtime` is on npm, that install is
the recommended route.

## Security

The console executes plugins, so the runtime's threat model applies in full: **the sandbox is not a security
boundary**. See [SECURITY.md](SECURITY.md) for what is in scope for this repository, what belongs to the
runtime repository, and what belongs to the plugin's author.

## License

MIT — see [LICENSE](LICENSE). Third-party dependencies and their licenses (including the LGPL-3.0 libvips
binaries pulled in by `sharp`) are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Contributing

Issues and pull requests are welcome — read [CONTRIBUTING.md](CONTRIBUTING.md) first. In short: this
repository is a published snapshot of an upstream development repository; the CI files are injected from
upstream templates and must not be edited here; and a pull request has to be carried upstream before it can
take effect in a later snapshot. Please sign your commits off (`git commit -s`); this project uses the DCO,
not a CLA.

## Related repositories

| Repository | What it is |
| --- | --- |
| [`kongtong9527/lingshu-runtime`](https://github.com/kongtong9527/lingshu-runtime) | The runtime and the `lingshu` CLI (the sandbox this console drives) |
| [`kongtong9527/lingshu-plugins`](https://github.com/kongtong9527/lingshu-plugins) | Small set of documentation-grade sample plugins plus a manifest |
| [`kongtong9527/lingshu-ios`](https://github.com/kongtong9527/lingshu-ios) | SwiftUI + JavaScriptCore host that runs the same `.plugin.js` files on device |

Each repository is an independent snapshot with its own license; none of them contains content sources.

---

Snapshot: `2026-10-17` · version `0.1.7`
