# Security Policy

## Supported versions

This repository is published as periodic snapshots. Only the **current snapshot** (`0.1.5`, dated
`2026-10-17`) is supported; earlier snapshots are not patched. Please reproduce a report against a fresh
checkout of the current snapshot before sending it.

## Threat model: the sandbox is not a security boundary

The dev console drives the Lingshu runtime, so the runtime's threat model applies here in full.

Plugins are executed inside a `node:vm` context that **shares the host V8 heap and the host process** with
the console (front-end assets, BFF and plugin runs live in the same Node process as the runtime). `node:vm`
is a *script isolation* facility, not a *security isolation* facility.

What the sandbox does provide:

- A curated global environment: `require`, `process`, `fs`, `Buffer`, `setTimeout`, `setInterval` and
  friends are set to `undefined`.
- One auditable entry point for everything a plugin may touch: the `$lib` namespace (`$lib.http`,
  `$lib.storage`, `$lib.settings`, `$lib.util`, `$lib.ui`, `$lib.browser` plus bundled libraries).
- Deterministic, replayable runs, and a request log that shows every HTTP request a plugin made.

What it explicitly does **not** provide, and what we therefore do not treat as a vulnerability:

- Containment of malicious code. Prototype-chain escapes
  (for example `this.constructor.constructor('return process')()`), dynamic `import()` and similar paths out
  of a `node:vm` context are **known and expected**.
- Isolation from the BFF process, its environment variables, its credentials or the local filesystem.
- Protection from a plugin exfiltrating whatever the console is allowed to reach on your network.

**Do not run plugins you do not trust.** The BFF binds to `127.0.0.1` by default and the console assumes a
single local user; it is a development tool, not a hardened multi-user service. Exposing the BFF to an
untrusted network is out of scope for this project and unsafe.

## Plugins and content are third-party (and not ours)

Plugins are supplied by third parties. This project does not provide, host, distribute, audit, endorse or
take responsibility for plugin code, for the content, legality or terms of any site a plugin talks to, or for
any content retrieved through it. A security problem inside a third-party plugin belongs to that plugin's
author. This project maintains no content sources and no content policy — see
[CONTRIBUTING.md §2](CONTRIBUTING.md#2-scope-what-this-repository-contains).

## In scope for this repository

- The BFF under `server/src/`: plugin discovery and run endpoints, parameter handling, the request-tracing
  store, the image/media proxy (`proxy.ts`), the browser channel (`browser-channel.ts`) and the `$lib.ui`
  SSE bridge (`ui-bridge.ts`).
- The front-end under `src/`, including anything that renders plugin-provided strings or URLs (the preview
  and the capture/attachment paths are the interesting ones).
- Local privilege issues that a *plugin* can escalate through the console beyond what the plugin could do in
  the runtime alone (for example a proxy endpoint that can be pointed at arbitrary hosts, or a path traversal
  through a fixture or media path).
- Anything in this repository that discloses credentials, tokens or personal data.

## Out of scope

- The documented inability of `node:vm` to contain hostile code (see above).
- Third-party plugins and the sites they access, and content retrieved through them.
- Exposure of the BFF to a network you do not control, or to other users of your machine; the console
  assumes a single trusted local user and binds to loopback.
- Vulnerabilities in upstream dependencies with no exploitable path through this repository's code (report
  those upstream — see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).
- Denial of service that only affects a run you started yourself in your own browser.

## Reporting a vulnerability

**Please do not open a public issue for a security report.**

- Preferred: open a private advisory at
  <https://github.com/kongtong9527/lingshu-devconsole/security/advisories/new> — it stays private between you and the
  maintainers until a fix is published.
- If you cannot use advisories, open a minimal issue that asks for a private contact channel **without
  including the details**, and a maintainer will follow up.

Please include: the affected snapshot version, the exact commands or steps, a minimal reproduction, the impact
you believe it has, and whether you intend to disclose publicly. If the defect is in the runtime rather than
in the console, we may move the report to
[`kongtong9527/lingshu-runtime`](https://github.com/kongtong9527/lingshu-runtime).

## What to expect

This is a volunteer-run project published as periodic snapshots. Reports are handled on a best-effort basis:
acknowledgement when someone is available, triage against the threat model above, and a fix carried in the
next snapshot (which means the fix appears here only after the following release). There is no bug-bounty
programme and no response-time guarantee.
