/**
 * Harness flavor detection shared by the scanner and the CLI resolver.
 *
 * Two layouts are supported:
 *
 *   - **source**    a git checkout: `package.json` next to a `packages/` tree;
 *   - **installed** a lightweight `~/.dsh` tree: one or more `node_modules`
 *     scopes that contain `@deepseek-ai` packages (hoisted, per-profile or
 *     pnpm virtual stores).
 *
 * Keeping this module free of `util.mjs` keeps the import graph acyclic:
 * `util` -> `harness-detect` -> `installed-scan`.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  findScopeRoots,
  isDirectoryLike,
  isInstalledRoot,
  readInstalledVersion,
} from './installed-scan.mjs'

/** True when `root` is a Harness source checkout (`package.json` + `packages/`). */
export function isSourceRoot(root) {
  return fs.existsSync(path.join(root, 'package.json')) && isDirectoryLike(path.join(root, 'packages'))
}

/** Read the Harness version from an `@deepseek-ai/dsh/package.json` when present. */
export function readSourceVersion(root) {
  const candidates = [
    path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    path.join(root, 'node_modules', '.pnpm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    path.join(root, 'apps', 'cli', 'package.json'),
    path.join(root, 'package.json'),
  ]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      if (parsed?.name === '@deepseek-ai/dsh' && parsed.version) return String(parsed.version)
    } catch {
      // Try the next candidate.
    }
  }
  return undefined
}

/**
 * Detect whether a path is a source checkout or a lightweight installation.
 * A source checkout wins when both layouts are present.
 *
 * @param {string} harnessRoot candidate root or `@deepseek-ai` scope path.
 * @returns {{ mode: 'source'|'installed', root: string, harnessVersion?: string, scopeRoots?: string[] }|undefined}
 */
export function detectHarnessMode(harnessRoot) {
  if (!harnessRoot) return undefined
  const root = path.resolve(harnessRoot)
  if (isSourceRoot(root)) {
    return { mode: 'source', root, harnessVersion: readSourceVersion(root) }
  }
  if (isInstalledRoot(root)) {
    return {
      mode: 'installed',
      root,
      harnessVersion: readInstalledVersion(root),
      scopeRoots: findScopeRoots(root),
    }
  }
  return undefined
}
