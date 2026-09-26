/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAAT_GATEWAY_BASIC_USER?: string;
  readonly VITE_MAAT_GATEWAY_BASIC_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
