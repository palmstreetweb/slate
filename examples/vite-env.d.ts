/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_FORM_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
