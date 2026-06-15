/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_FORM_BASE?: string;
  readonly VITE_UPLOAD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
