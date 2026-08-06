// Module resolution for running repo TypeScript directly under Node.
//
//   node --import ./scripts/ts-alias-hook.mjs scripts/audit-dry-run.ts <args>
//
// Node 24 strips types on its own, but it knows nothing about tsconfig, so three of the
// repo's ordinary import styles do not resolve without help. Each of these was an actual
// error, in this order, while getting the pipeline to run:
//
//   1. `@/lib/x`               tsconfig paths map `@/*` to the repo root. Node does not
//                              read tsconfig, so this is a bare specifier and fails as a
//                              missing package.
//   2. `./x` and `./x/`        extensionless and directory specifiers. ESM requires a full
//                              path, so these fail ERR_MODULE_NOT_FOUND and
//                              ERR_UNSUPPORTED_DIR_IMPORT respectively.
//   3. `docs/rubric/rubric.json`  lib/scoring/rubric.ts imports it, and ESM requires an
//                              explicit `with { type: 'json' }` that the source does not
//                              carry (tsconfig's resolveJsonModule handles it for tsc and
//                              vitest). Without this it dies ERR_IMPORT_ATTRIBUTE_MISSING.
//
// WHY A SEPARATE FILE RATHER THAN registerHooks INSIDE THE SCRIPT. A hook installed in the
// script's own body runs too late: the entry's whole transitive graph is resolved before
// its first statement executes, and rubric.json is in that graph. Loading the hook with
// --import is what puts it in place first. Keeping it separate also lets the script use
// ordinary static `@/` imports, which means tsc type-checks it like any other file — the
// main reason a debug script belongs in the repo at all.
//
// Not a build step and not a bundler. Fifteen lines of resolution with no knowledge of the
// app, used only by scripts/. `next lint` does not cover scripts/, and .mjs is not
// type-checked, which is acceptable for a file with no logic in it.

import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** A filesystem path, with the extension ESM insists on and TypeScript omits. */
function resolveFile(path) {
  if (path.endsWith('.ts') || path.endsWith('.json') || path.endsWith('.mjs')) return path
  if (existsSync(`${path}.ts`)) return `${path}.ts`
  // A directory specifier means its index, which is how the repo's barrel files are written.
  if (existsSync(`${path}/index.ts`)) return `${path}/index.ts`
  return path
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = specifier

    if (specifier.startsWith('@/')) {
      target = pathToFileURL(resolveFile(repoRoot + specifier.slice(2))).href
    } else if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
      // Only relative specifiers FROM TypeScript get rewritten. Node's own resolution is
      // correct for everything else, and rewriting node_modules paths would break it.
      const resolved = new URL(specifier, context.parentURL)
      target = pathToFileURL(resolveFile(fileURLToPath(resolved))).href
    }

    const result = nextResolve(target, context)

    if (target.endsWith('.json')) {
      // The attribute the source cannot carry without breaking tsc/vitest.
      return { ...result, format: 'json', importAttributes: { type: 'json' } }
    }
    return result
  },
})
