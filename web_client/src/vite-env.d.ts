/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_AUTH_BASE_URL?: string
  readonly VITE_GAME_API_URL?: string
  readonly VITE_STOCK_API_URL?: string
  readonly VITE_ENABLE_GUEST_LOGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
