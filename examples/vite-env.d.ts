/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_FORM_BASE?: string;
  readonly VITE_UPLOAD_URL?: string;
  /** Public Sentry DSN for the deployed site. Empty in local dev. */
  readonly VITE_SENTRY_DSN?: string;
  /** Origin printed in dynamic QR codes (ADR-075 §4). Defaults to slateforms.vercel.app. */
  readonly VITE_QR_SHORT_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
