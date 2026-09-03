import { defineConfig } from 'tsdown'

/**
 * Two faces, both emitted into `lib/` (package exports point at
 * lib/index.js and lib/client.js).
 *
 * The browser half MUST use the official closure-factory recipe
 * (packages/client/tsdown.client.ts clientConfig): a `window.__ModuleLoader__
 * .load({ id, factory: (require) => {...} })` classic-script artifact —
 * no `import` statements, or the client-modules batch parse throws
 * "Cannot use import statement outside a module" and the whole plugin
 * roster fails to register. Externals resolve through the injected require
 * (React + shell-seeded ui-primitives + jsx-runtime); everything else inlines.
 */

const STANDARD_ID = 'dsh-session-spend'

/** Shell-seeded module-table rows our bundle requests (baseline externals). */
const isStandardExternal = (specifier: string): boolean =>
  specifier === 'react'
  || specifier === 'react/jsx-runtime'
  || specifier === '@deepseek-ai/dsh-client-ui-primitives'

export default defineConfig([
  // Node half: host loader entry (no host behavior), ESM `.js` + types.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'es2022',
    outDir: 'lib',
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    dts: { entry: 'src/index.ts' },
    external: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery'],
  },
  // Browser half: closure-factory artifact, exactly the official format.
  {
    entry: { client: 'src/client/index.ts' },
    format: ['cjs'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'lib',
    // clean must stay off: the node-half output above shares lib/.
    clean: false,
    dts: false,
    deps: {
      neverBundle: isStandardExternal,
      alwaysBundle: (specifier: string) => !isStandardExternal(specifier),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      // banner → intro → module wrapper order (same as the official preset):
      // intro must precede the CJS `exports` references or the factory throws
      // "exports is not defined" the moment it executes.
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(STANDARD_ID)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
