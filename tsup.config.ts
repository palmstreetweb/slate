import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  target: 'es2022',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  injectStyle: false,
  // CSS imports inside source files are pure side effects (the wrapper
  // expects the global stylesheet to be loaded). At build time we treat
  // them as no-ops in JS — onSuccess concatenates src/styles/*.css into
  // a single dist/styles.css that consumers import via the
  // `@palmstreetweb/forms/styles.css` entry.
  loader: { '.css': 'empty' },
  onSuccess: 'node scripts/bundle-css.mjs',
  outExtension({ format }) {
    return { js: format === 'esm' ? '.js' : '.cjs' };
  },
});
