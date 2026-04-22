/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_REST_ENDPOINT?: string
  readonly VITE_APP_ADMINS_IDS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
