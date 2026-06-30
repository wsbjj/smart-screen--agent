/// <reference types="vite/client" />

import type { DesktopApi } from './shared/desktopApi.js'

declare global {
  const __APP_VERSION__: string

  interface Window {
    desktopApi?: DesktopApi
  }
}
