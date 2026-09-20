Standalone Slate brand reference page — logo lockups, palette, spacing, misuse examples. Static HTML in this folder; open `index.html` in a browser locally.

**Live:** [slateforms.vercel.app/brand](https://slateforms.vercel.app/brand) (copied into the examples build at deploy time).

`slate-lockup.svg` / `slate-lockup.png` are the email lockup (mark + wordmark). Regenerate with `node scripts/render-slate-lockup.mjs` after installing `@resvg/resvg-js`.

Login email preview: `npx vite-node scripts/preview-auth-email.ts` then open [localhost:5173/brand/auth-email-preview.html](http://localhost:5173/brand/auth-email-preview.html).
