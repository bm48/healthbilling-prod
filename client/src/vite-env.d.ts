/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  /** Optional public site URL (e.g. invite emails). Defaults to window.location.origin in app code. */
  readonly VITE_APP_ORIGIN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
