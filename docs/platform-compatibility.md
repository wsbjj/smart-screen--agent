# Platform Compatibility Guide

本项目是 Electron 桌面应用，目标平台是 Windows、macOS、Linux。任何 AI 或开发者修改代码时，都必须把三平台兼容性作为默认约束。

## 需要重点检查的区域

- `package.json` scripts
- Electron main process: `electron/**/*.ts`
- preload bridge: `electron/**/*.cts`
- file system, dialogs, export/import, native modules
- build and packaging config
- GitHub Actions and release workflows

## npm Scripts

禁止使用只适用于 Unix shell 的写法：

```bash
VITE_DEV_SERVER_URL=http://localhost:5173 electron .
rm -rf dist
cp -r a b
mkdir -p release
export NODE_ENV=production
```

推荐写法：

- 简单命令用 npm scripts。
- 环境变量、复制、删除、启动子进程等复杂行为放到 `scripts/*.mjs`。
- 子进程启动 Electron 前删除 `ELECTRON_RUN_AS_NODE`。

## Paths and File Systems

必须使用 `node:path`：

```ts
import { join } from 'node:path'

const preloadPath = join(__dirname, 'preload.cjs')
```

避免：

```ts
const preloadPath = __dirname + '/preload.cjs'
```

注意：

- Linux 文件系统通常大小写敏感。
- 不要硬编码 `/Users/...`、`C:\...`、`/tmp/...`。
- 临时目录使用 `node:os` 的 `tmpdir()`。
- 用户数据目录优先使用 Electron 的 `app.getPath(...)`。

## Electron Main Process

本项目使用 native ESM。Electron API 访问必须集中走：

```ts
import { app, BrowserWindow, dialog, ipcMain } from './electronApi.js'
```

不要在 ESM 主进程文件里直接写：

```ts
import { app, dialog } from 'electron'
```

原因：在不同启动环境下，native ESM 对 Electron 包的解析可能和 CommonJS 不一致。项目使用 `electron/electronApi.ts` 作为稳定边界。

## Platform Branches

出现 `process.platform` 时，必须检查：

- `win32`
- `darwin`
- Linux fallback

macOS 常见行为：

```ts
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

其他平台分支必须写清楚原因，不能只在当前开发机上验证。

## Native Dependencies

本项目包含 native 或平台相关依赖，例如 Electron、keytar、文件解析和系统对话框。

修改相关代码时要考虑：

- Windows 安装和运行
- macOS arm64/x64
- Linux CI 依赖，例如 libsecret
- 打包后 ASAR 路径和 native 模块加载

## Packaging

当前使用 `electron-builder`。修改打包配置时要考虑：

- Windows: NSIS
- macOS: DMG，arm64/x64 或 universal 策略
- Linux: AppImage、deb 或项目选择的发行格式

不要只在当前平台验证打包相关改动。

## Release Tags

发布 tag 必须和 `package.json` 里的 `version` 完全一致。

例如当前版本是：

```json
"version": "0.0.0"
```

那么 Git tag 必须是：

```bash
git tag 0.0.0
```

不要使用：

```bash
git tag v0.0.0
```

CI 会在 tag 构建时运行：

```bash
npm run check:release-version
```

如果 tag 和 `package.json` 版本不一致，发布流程必须失败。

## Validation Checklist

本地修改后至少运行：

```bash
npm run check:platform
npm run check:release-version
npm run lint
npm test
npm run build
```

修改 Electron 启动、环境变量、main process 或 preload 时，还要运行：

```bash
npm run dev
```

CI 必须在 Windows、macOS、Linux 上运行基础验证。
