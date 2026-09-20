import { defineConfig } from '@neon/config/v1';

/**
 * Neon backend-as-code for Slate (ADR-029).
 * Link the project (`neonctl auth` + project link), then `npx neonctl@latest deploy`.
 */
export default defineConfig({
  preview: {
    storage: {
      buckets: {
        'form-uploads': {
          access: 'private',
        },
      },
    },
    functions: {
      submitresponse: {
        name: 'Slate public form submit',
        source: './neon/functions/submit-response/index.ts',
      },
      storagesign: {
        name: 'Slate Object Storage presign',
        source: './neon/functions/storage-sign/index.ts',
      },
      authemail: {
        name: 'Slate branded auth email',
        source: './neon/functions/auth-email/index.ts',
      },
    },
  },
});
