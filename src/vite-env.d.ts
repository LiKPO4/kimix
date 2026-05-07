/// <reference types="vite/client" />

import type { WindowAPI } from "../electron/preload";

declare global {
  interface Window {
    api: WindowAPI;
  }
}
