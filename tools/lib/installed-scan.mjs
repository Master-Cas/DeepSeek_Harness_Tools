/**
 * Lightweight scanner for installed DeepSeek Harness trees.
 *
 * A `~/.dsh` installation does not ship the Harness TypeScript sources: it
 * keeps published `@deepseek-ai/*` packages whose browser halves are compiled
 * into `lib/client.js` bundles. Those bundles reference the Harness runtime
 * and cannot be executed outside the browser, so everything here is read
 * statically with the helpers from `static-js.mjs`:
 *
 *   - `const NS = "namespace"` string constants (and aliases such as `NS$1`);
 *   - `const en = { ... }` dictionaries, including `...spread` bases;
 *   - `ctx.locale.register(NS, { zh, en })` and `{ zh: zh$1, en: en$1 }`;
 *   - inline/literal namespaces such as `register("documentMarkdown", ...)`;
 *   - `register(NS, locale, dict)` tuple lists (`[["en", { ... }]]`).
 *
 * Package entries may be real directories or symlinks (pnpm/workspace
 * layouts), so every lookup follows `statSync`/`realpath` instead of relying
 * on `dirent.isDirectory()`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { countNamespacePlaceholders } from './placeholders.mjs'
import {
  collectDeclarations,
  evaluateStatic,
  extractBalanced,
  findRegisterCalls,
  parseStringLiteral,
  stripComments,
} from './static-js.mjs'
import { hash, sortedKeys } from './util.mjs'

/** True when `candidate` exists and resolves (through symlinks) to a directory. */
export function isDirectoryLike(candidate) {
  try {
    return fs.statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

/** Directory names of `dir`, following symlinks; missing dirs yield []. */
function directoryNames(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const names = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory() || (entry.isSymbolicLink() && isDirectoryLike(full))) names.push(entry.name)
  }
  return names
}

/**
 * Candidate `node_modules` roots for an installed tree: the root itself, the
 * hoisted store, per-profile stores and pnpm's virtual store.
 */
function nodeModulesRoots(root) {
  const roots = []
  const push = (candidate) => {
    if (candidate && !roots.includes(candidate)) roots.push(candidate)
  }

  if (path.basename(root) === 'node_modules') push(root)
  push(path.join(root, 'node_modules'))
  push(path.join(root, 'profiles', 'node_modules'))
  push(path.join(root, 'lib', 'node_modules'))
  push(path.join(root, 'node_modules', '.pnpm', 'node_modules'))

  for (const profile of directoryNames(path.join(root, 'profiles'))) {
    push(path.join(root, 'profiles', profile, 'node_modules'))
    push(path.join(root, 'profiles', profile, 'node_modules', '.pnpm', 'node_modules'))
  }
  for (const child of directoryNames(root)) {
    if (child === 'node_modules' || child === 'profiles' || child === 'lib' || child.startsWith('.')) continue
    push(path.join(root, child, 'node_modules'))
  }
  return roots
}

/**
 * Every `@deepseek-ai` scope directory reachable from `root`.
 * @param {string} root install root (for example `~/.dsh`).
 * @returns {string[]} sorted absolute scope paths.
 */
export function findScopeRoots(root) {
  const resolved = path.resolve(root)
  const scopes = []
  if (path.basename(resolved) === '@deepseek-ai' && isDirectoryLike(resolved)) scopes.push(resolved)
  for (const nodeModules of nodeModulesRoots(resolved)) {
    const scope = path.join(nodeModules, '@deepseek-ai')
    if (isDirectoryLike(scope) && !scopes.includes(scope)) scopes.push(scope)
  }
  return scopes.sort()
}

/** True when `root` contains at least one `@deepseek-ai` scope directory. */
export function isInstalledRoot(root) {
  return findScopeRoots(root).length > 0
}

/** Read `@deepseek-ai/dsh`'s version from the first scope that has it. */
export function readInstalledVersion(root) {
  for (const scope of findScopeRoots(root)) {
    const manifest = path.join(scope, 'dsh', 'package.json')
    try {
      const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'))
      if (parsed && parsed.version) return String(parsed.version)
    } catch {
      // Try the next scope.
    }
  }
  return undefined
}

/** Collect every `<scope>/<pkg>/lib/client.js` compiled bundle. */
export function collectClientBundles(scopeRoot) {
  const bundles = []
  for (const name of directoryNames(scopeRoot)) {
    const bundle = path.join(scopeRoot, name, 'lib', 'client.js')
    try {
      if (fs.statSync(bundle).isFile()) bundles.push(bundle)
    } catch {
      // Package has no compiled client half.
    }
  }
  return bundles.sort()
}

/** Resolve a namespace expression (literal or string constant). */
function resolveNamespace(expression, symbols) {
  const literal = parseStringLiteral(expression)
  if (literal !== undefined) return literal
  const value = evaluateStatic(expression, symbols)
  return typeof value === 'string' ? value : undefined
}

/** Pull the English entry out of a `{ zh, en }` options object literal. */
function dictionaryFromOptions(optionsText, symbols) {
  const options = evaluateStatic(optionsText, symbols)
  if (!options || typeof options !== 'object' || Array.isArray(options)) return undefined
  return options.en
}

/** Find a `["en", { ... }]` tuple list and evaluate its dictionary. */
function dictionaryFromTuples(text, symbols) {
  const pattern = /\[\s*['"]en['"]\s*,/g
  for (const match of text.matchAll(pattern)) {
    let index = match.index + match[0].length
    while (index < text.length && /\s/.test(text[index])) index++
    if (text[index] !== '{') continue
    const balanced = extractBalanced(text, index)
    if (!balanced) continue
    const value = evaluateStatic(balanced.text, symbols)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  }
  return undefined
}

/**
 * Resolve the English dictionary for one register call.
 * @param {object} call `findRegisterCalls` entry.
 * @param {string} text comment-stripped bundle body.
 * @param {Map<string, string>} symbols declarations in the bundle.
 */
function resolveDictionary(call, text, symbols) {
  const [, second, third] = call.args
  if (second && second.trim().startsWith('{')) return dictionaryFromOptions(second.trim(), symbols)
  if (third) {
    if (parseStringLiteral(second) === 'en') return evaluateStatic(third, symbols)
    return dictionaryFromTuples(text, symbols)
  }
  return undefined
}

/**
 * Scan an installed (`~/.dsh`) tree and return the English catalog.
 *
 * @param {string} harnessRoot an installed root or a `@deepseek-ai` scope.
 * @returns {Promise<{ version: number, mode: 'installed', root: string, harness: string, harnessVersion?: string, namespaces: Record<string, Record<string,string>>, sources: Record<string,string>, stats: object, warnings: string[] }>}
 */
export async function scanInstalledHarness(harnessRoot) {
  const root = path.resolve(harnessRoot)
  const namespaces = {}
  const sources = {}
  const warnings = []
  const seenBundles = new Set()

  for (const scopeRoot of findScopeRoots(root)) {
    for (const bundle of collectClientBundles(scopeRoot)) {
      let real
      try {
        real = fs.realpathSync(bundle)
      } catch {
        real = bundle
      }
      if (seenBundles.has(real)) continue
      seenBundles.add(real)

      let raw
      try {
        raw = fs.readFileSync(bundle, 'utf8')
      } catch {
        continue
      }
      if (!raw.includes('locale.register')) continue

      const text = stripComments(raw)
      const symbols = collectDeclarations(text)
      for (const call of findRegisterCalls(text)) {
        const [nsArg] = call.args
        if (!nsArg) continue
        const namespace = resolveNamespace(nsArg, symbols)
        if (!namespace) {
          warnings.push(`${bundle}: could not resolve namespace expression "${nsArg}"`)
          continue
        }
        if (namespaces[namespace]) continue

        const dictionary = resolveDictionary(call, text, symbols)
        if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) {
          // `register(NS, "zh", dict)` is a sibling of the English call: it is
          // a real registration, just not the one that owns the English
          // dictionary, so only warn when no locale was named or English
          // itself could not be resolved.
          const locale = parseStringLiteral(call.args[1])
          if (locale === undefined || locale === 'en') {
            warnings.push(`${bundle}: no English dictionary found for namespace "${namespace}"`)
          }
          continue
        }

        namespaces[namespace] = {}
        for (const key of sortedKeys(dictionary)) namespaces[namespace][key] = String(dictionary[key])
        sources[namespace] = path.relative(root, bundle) || bundle
      }
    }
  }

  const ordered = {}
  for (const namespace of sortedKeys(namespaces)) ordered[namespace] = namespaces[namespace]

  let keys = 0
  for (const dictionary of Object.values(ordered)) keys += Object.keys(dictionary).length

  return {
    version: 1,
    mode: 'installed',
    root,
    harness: path.basename(root),
    harnessVersion: readInstalledVersion(root),
    namespaces: ordered,
    sources,
    stats: {
      namespaces: Object.keys(ordered).length,
      keys,
      placeholders: countNamespacePlaceholders(ordered),
      catalogHash: hash(JSON.stringify(ordered)),
    },
    warnings,
  }
}
