# Agent Instructions

请使用中文回复。

## Project Goal

This is a cross-platform Electron desktop app. Every change must preserve support for:

- Windows
- macOS
- Linux

When coding, assume the code may be authored on macOS but must run and build on all three platforms.

## Cross-Platform Rules

Read `docs/platform-compatibility.md` before changing npm scripts, Electron main-process code, file paths, native integrations, packaging, or CI.

Mandatory rules:

- Do not use POSIX-only npm script syntax such as `VAR=value command`.
- Prefer small Node scripts for environment setup, process spawning, cleanup, copying, or deleting files.
- Use `node:path` APIs such as `join`, `resolve`, `dirname`, `basename`, and `extname`; do not concatenate paths with `/` or `\`.
- Do not hardcode `/Users/...`, `/tmp/...`, drive letters, or Windows backslash paths.
- Treat file name casing as significant because Linux file systems are commonly case-sensitive.
- Electron main-process imports must follow the existing local Electron API bridge in `electron/electronApi.ts`.
- Do not allow `ELECTRON_RUN_AS_NODE` to leak into spawned Electron app processes.
- Release git tags must exactly match `package.json` `version`; do not add a leading `v`.
- Every `process.platform` branch must explicitly account for `win32`, `darwin`, and Linux behavior, or document why a branch is intentionally platform-specific.
- Before saying a change works, run the relevant validation commands listed in `docs/platform-compatibility.md`.

## Preferred Validation

For broad changes, run:

```bash
npm run check:platform
npm run check:release-version
npm run lint
npm test
npm run build
```

For Electron startup changes on Windows, also run:

```bash
npm run dev
```
