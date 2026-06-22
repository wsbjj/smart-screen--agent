# Copilot Instructions

请使用中文回复。

This repository contains a cross-platform Electron app for Windows, macOS, and Linux.

When suggesting or editing code:

- Follow `docs/platform-compatibility.md`.
- Keep npm scripts cross-platform; avoid POSIX-only env syntax such as `VAR=value command`.
- Use Node scripts for non-trivial shell behavior.
- Use `node:path` for paths; do not hardcode platform-specific absolute paths.
- Respect Linux case-sensitive imports.
- Use the local Electron API bridge in `electron/electronApi.ts`.
- Do not pass `ELECTRON_RUN_AS_NODE` into spawned Electron app processes.
- Release git tags must exactly match `package.json` `version`; do not add a leading `v`.
- Run or recommend `npm run check:platform`, `npm run check:release-version`, `npm run lint`, `npm test`, and `npm run build` for compatibility changes.
