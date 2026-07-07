/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Base URL of the deployed API server (e.g. https://trackity-api.up.railway.app).
  // Left unset in local dev, where Vite's dev-server proxy forwards /api to
  // the local Express server instead (see vite.config.ts).
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
