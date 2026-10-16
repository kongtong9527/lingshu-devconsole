# Contributing to Lingshu DevConsole

Thanks for taking the time to contribute. This document explains how this repository is produced, what
belongs here, and what a change has to look like to survive the next release.

## 1. How this repository is produced (read this first)

This repository (`kongtong9527/lingshu-devconsole`) is a **published snapshot** of an upstream development repository. Each
release is written by publishing tooling that takes a whitelisted subset of the upstream tree, applies
redaction rules, injects the files under `.github/` and the top-level community documents from a template,
and commits the result here.

Two consequences you cannot work around:

- **A merged commit here is not durable.** The next release replaces the tracked tree with a fresh upstream
  snapshot, so anything that only exists here disappears again. **Pull requests must be carried upstream to
  take effect.** Maintainers import accepted patches into the upstream repository (keeping the original
  author) and the next snapshot brings them back here. Until that happens, treat this repository as
  read-mostly.
- **Do not edit CI in this repository.** Everything under `.github/` — the workflows, the issue templates
  and the pull-request template — is **injected from the upstream templates** on every release. Local edits
  are silently overwritten and cannot be reviewed. If a workflow needs to change, say so in an issue or in
  your pull-request description, and the maintainers will change the upstream template instead.

## 2. Scope: what this repository contains

In scope: the React front-end (`src/`), the Fastify BFF (`server/src/`), the host-side documentation
(`docs/`, `AGENTS.md`) and this repository's own community documents.

**Out of scope — these will be closed without discussion:**

- **Content sources, site implementations and content policy.** This repository contains no site-specific
  plugin, no site list, no feed and no allow/deny list of sites. It also does not bundle plugin fixtures or
  scraped data. Requests to add one — in code, in fixtures, in documentation or in an issue — are out of
  scope by design.
- **Requests to make the console fetch, bundle, proxy or render content for adult or pirate sites**, or any
  other request whose purpose is to add content sources rather than to improve the console. Such issues and
  pull requests are not accepted, and this repository maintains no such policy to change.
- Support for third-party plugins. A plugin that behaves badly is a matter between you and whoever gave it
  to you. If a plugin exposes a defect in the *console* (wrong preview, wrong request tracing, a broken
  proxy path, a swallowed error), that is in scope — please report it with a minimal reproduction built from
  a synthetic plugin and a local fixture instead of a live site.
- Changes to the runtime, the card DSL or the `$lib` contract: those live in
  [`kongtong9527/lingshu-runtime`](https://github.com/kongtong9527/lingshu-runtime). Open the change there; this
  repository only consumes them.

## 3. Development setup

```bash
npm ci
npm run build          # type check → BFF compile → web bundle
npm run dev            # Vite on 5180 + BFF on 5181

# The console needs a plugin directory; nothing is bundled here.
LINGSHU_PLUGINS_DIR=/path/to/plugins npm run dev
```

Before opening a pull request, run what CI runs:

```bash
npm run build
npm test
```

- **`npm test` does not type-check** (Vite and Vitest use esbuild). `npm run build` runs `typecheck` first;
  a wrong contract field can leave the tests green and the build red.
- Contract types are resolved from the **installed** `@lingshu/runtime` package, so run `npm ci` first
  and re-check after the runtime dependency changes.
- Tests that need a plugin corpus **skip themselves** in this repository (no corpus ships here). Do **not**
  set `LINGSHU_REQUIRE_PLUGIN_CORPUS=1` — that flag means "the corpus must be present" and belongs to the
  upstream development repository.

## 4. House rules that are easy to break

These are documented in more detail in [`docs/`](docs) and [`AGENTS.md`](AGENTS.md); the short version:

- **Never re-implement the card-DSL verdict.** Import `validateCardDSL` / `shouldFallbackCard` from
  `@lingshu/runtime`. A second copy is how the hosts drifted apart before.
- **Never hard-code a plugin directory.** Resolution goes through the BFF's resolver
  (`?dir=` → `LINGSHU_PLUGINS_DIR` / `--plugins-dir` → `<cwd>/plugins`). No sibling-checkout paths.
- **Preview must render what the runtime and the device render.** A preview that lies about the data is
  worse than no preview: when you touch a renderer, keep it isomorphic to the other two hosts and update
  `docs/`.

## 5. Pull requests

1. Open an issue first for anything larger than a bug fix, so the change can be discussed before you spend
   time on it.
2. Keep the change focused; one topic per pull request.
3. Describe **why**, not only **what**, and include the commands you ran.
4. Sign off every commit (`git commit -s`), certifying the [Developer Certificate of Origin](https://developercertificate.org/).
   This project uses the **DCO instead of a CLA** — there is no copyright assignment to sign.
5. Expect a delay: accepted work is carried upstream before it can appear in a later snapshot, and review
   happens there.

## 6. Reporting bugs and security issues

- Functional bugs and feature requests: use the issue templates in this repository.
- **Security issues: do not open a public issue.** Follow [SECURITY.md](SECURITY.md).

## 7. License

By contributing you agree that your contribution is licensed under the MIT License of this repository
(see [LICENSE](LICENSE)). Third-party material you add must be compatible with MIT and must be listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) with its license text — note that this repository already
depends on LGPL-3.0 binaries through `sharp`, so check §1 there before adding another image-processing
dependency.

## 8. Code of conduct

Participation in this project is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
