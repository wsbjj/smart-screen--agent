/// <reference types="vite/client" />

import type { DesktopApi } from './shared/desktopApi.js'

declare global {
  interface Window {
    desktopApi?: DesktopApi
  }
}
