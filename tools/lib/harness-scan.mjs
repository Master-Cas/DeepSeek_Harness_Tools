/**
 * Dynamic Harness locale discovery.
 *
 * `scanHarness(path)` autodetects the harness flavor and never hardcodes a
 * namespace list:
 *
 *   - **source** (a checkout with `package.json` + `packages/`): walks the
 *     TypeScript source, finds every `ctx.locale.register(...)` call, resolves
 *     the namespace and dictionary expressions, and imports the dictionary
 *     module so values and placeholders are exact. The source `.ts` modules
 *     are preferred (Node >= 22.6 strips TypeScript types), with the compiled
 *     `lib/types/**` ESM as a fallback.
 *   - **installed** (a lightweight `~/.dsh` tree with an `@deepseek-ai` scope):
 *     reads published `@deepseek-ai/<pkg>/lib/client.js` bundles *statically*
 *     (they reference the browser runtime and must not be executed), see
 *     `installed-scan.mjs`.
 *
 * Registration forms covered by both modes:
 *
 *   register(NS, { zh, en })                 // typed bilingual form
 *   register(NS, { zh: zhX, en: enX })       // aliased imports
 *   register('literal.ns', { zh, en })       // inline namespace literal
 *   register(NS, locale, dict)               // one locale per call / tuples
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { detectHarnessMode } from './harness-detect.mjs'
import { scanInstalledHarness } from './installed-scan.mjs'
import { countNamespacePlaceholders } from './placeholders.mjs'
import { extractBalanced, findRegisterCalls, splitTopLevel } from './static-js.mjs'
import { hash, sortedKeys } from './util.mjs'

// Keep the historical helper exports available from this module too.
export { extractBalanced, findRegisterCalls, splitTopLevel } from './static-js.mjs'

const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', 'types', 'coverage', 'tests', '__tests__'])

/** Recursively collect TypeScript sources below `<harness>/packages`. */
export function collectSourceFiles(harnessRoot) {
  const packagesRoot = path.join(harnessRoot, 'packages')
  const files = []
  const visit = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        visit(path.join(dir, entry.name))
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        const file = path.join(dir, entry.name)
        // Only package source, never build output or test suites.
        if (file.includes(`${path.sep}src${path.sep}`)) files.push(file)
      }
    }
  }
  visit(packagesRoot)
  files.sort()
  return files
}

/** Build a local-name to module/export map from named import statements. */
export function parseImportMap(text) {
  const map = new Map()
  const pattern = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g
  for (const match of text.matchAll(pattern)) {
    for (const piece of match[1].split(',')) {
      const raw = piece.trim()
      if (!raw) continue
      const aliased = raw.match(/^(\w+)\s+as\s+(\w+)$/)
      const imported = aliased ? aliased[1] : raw
      const local = aliased ? aliased[2] : raw
      map.set(local, { source: match[2], imported })
    }
  }
  return map
}

/** Collect `const NAME = 'literal'` declarations anywhere in a file. */
export function parseStringConsts(text) {
  const map = new Map()
  const pattern = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*['"]([^'"]+)['"]/g
  for (const match of text.matchAll(pattern)) map.set(match[1], match[2])
  return map
}

/** Map a source `.ts` path to its compiled `lib/types/**.js` sibling. */
export function compiledCandidates(sourceFile) {
  if (!/\.tsx?$/.test(sourceFile)) return []
  const js = sourceFile.replace(/\.tsx?$/, '.js')
  const marker = `${path.sep}src${path.sep}`
  const index = js.indexOf(marker)
  if (index === -1) return []
  return [`${js.slice(0, index)}${path.sep}lib${path.sep}types${path.sep}${js.slice(index + marker.length)}`]
}

/** Resolve candidate module paths for an import specifier. */
function moduleCandidates(sourceFile, specifier) {
  const base = path.resolve(path.dirname(sourceFile), specifier)
  const candidates = []
  if (/\.tsx?$/.test(base)) {
    candidates.push(base, ...compiledCandidates(base))
  } else if (path.extname(base)) {
    candidates.push(base)
  } else {
    for (const ext of ['.ts', '.tsx', '.js']) candidates.push(base + ext)
    candidates.push(...compiledCandidates(`${base}.ts`))
  }
  const seen = new Set()
  return candidates.filter((candidate) => {
    if (seen.has(candidate) || !fs.existsSync(candidate)) return false
    seen.add(candidate)
    return true
  })
}

const moduleCache = new Map()

/** Import a module with caching. */
async function importModule(file) {
  if (!moduleCache.has(file)) {
    moduleCache.set(file, import(pathToFileURL(file).href))
  }
  return moduleCache.get(file)
}

/** Load one named export through the import map, source first then compiled. */
export async function loadImportedExport(sourceFile, spec) {
  for (const candidate of moduleCandidates(sourceFile, spec.source)) {
    try {
      const module = await importModule(candidate)
      if (spec.imported in module) return module[spec.imported]
    } catch {
      // Try the next candidate (source TypeScript may be unavailable).
    }
  }
  throw new Error(`cannot resolve ${spec.imported} from "${spec.source}" in ${sourceFile}`)
}

/** Safely evaluate a plain JS object/array literal extracted from source. */
function evaluateLiteral(text) {
  // Literals come from the scanner's balanced extraction; disable scope access.
  // eslint-disable-next-line no-new-func
  const factory = new Function(`"use strict"; return (${text});`)
  return factory()
}

/** Resolve the `en` property of a register options object. */
async function resolveDictionary(sourceFile, valueText, imports, consts) {
  const text = valueText.trim()
  if (text.startsWith('{')) return evaluateLiteral(text)
  if (/^[A-Za-z_$][\w$]*$/.test(text)) {
    if (imports.has(text)) return loadImportedExport(sourceFile, imports.get(text))
    if (consts.has(text)) {
      const raw = consts.get(text)
      return raw.startsWith('{') ? evaluateLiteral(raw) : raw
    }
    throw new Error(`cannot resolve dictionary identifier "${text}" in ${sourceFile}`)
  }
  throw new Error(`unsupported dictionary expression "${text}" in ${sourceFile}`)
}

/** Extract the `en` entry from an options object body. */
async function dictionaryFromOptions(sourceFile, body, imports, consts) {
  for (const property of splitTopLevel(body)) {
    const colon = property.indexOf(':')
    const rawKey = (colon === -1 ? property : property.slice(0, colon)).trim()
    const key = rawKey.replace(/^['"]|['"]$/g, '')
    if (key !== 'en' && key !== `'en'`) continue
    const value = colon === -1 ? 'en' : property.slice(colon + 1).trim()
    return resolveDictionary(sourceFile, value, imports, consts)
  }
  return undefined
}

/** Extract the English entry from a `[locale, dict]` tuple list. */
function dictionaryFromLocaleTuples(text) {
  const match = text.match(/\[\s*['"]en['"]\s*,\s*\{/)
  if (!match) return undefined
  const brace = text.indexOf('{', match.index + match[0].length - 1)
  const balanced = extractBalanced(text, brace)
  if (!balanced) return undefined
  return evaluateLiteral(balanced.text)
}

/** Resolve a namespace expression to its string value. */
async function resolveNamespace(sourceFile, expression, imports, consts) {
  const text = expression.trim()
  const literal = text.match(/^['"]([^'"]+)['"]$/)
  if (literal) return literal[1]
  if (/^[A-Za-z_$][\w$]*$/.test(text)) {
    if (consts.has(text)) return consts.get(text)
    if (imports.has(text)) {
      const value = await loadImportedExport(sourceFile, imports.get(text))
      if (typeof value === 'string') return value
    }
  }
  return undefined
}

/**
 * Scan a Harness **source checkout** and return the English catalog.
 * @param {{ root: string, harnessVersion?: string }} detected detection result.
 * @returns {Promise<{ version: number, mode: 'source', root: string, harness: string, harnessVersion?: string, namespaces: Record<string, Record<string, string>>, sources: Record<string,string>, stats: object, warnings: string[] }>}
 */
export async function scanSourceHarness(detected) {
  const root = detected.root
  const files = collectSourceFiles(root)
  const namespaces = {}
  const sources = {}
  const warnings = []

  for (const file of files) {
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!text.includes('locale.register')) continue
    const imports = parseImportMap(text)
    const consts = parseStringConsts(text)
    const calls = findRegisterCalls(text)

    for (const call of calls) {
      const [nsArg, second, third] = call.args
      if (!nsArg) continue
      // Language-pack form `register(ns, 'es', dict)` is not a Harness source.
      if (typeof second === 'string' && /^['"][A-Za-z]/.test(second) && third) {
        if (/^['"]\w+(-[A-Za-z0-9]+)*['"]$/.test(second)) continue
      }
      let namespace
      try {
        namespace = await resolveNamespace(file, nsArg, imports, consts)
      } catch (error) {
        warnings.push(`${file}: namespace ${nsArg}: ${error.message}`)
        continue
      }
      if (!namespace) {
        warnings.push(`${file}: could not resolve namespace expression "${nsArg}"`)
        continue
      }

      let dictionary
      try {
        if (second && second.trim().startsWith('{')) {
          dictionary = await dictionaryFromOptions(file, second.trim().slice(1, -1), imports, consts)
        } else if (third) {
          dictionary = dictionaryFromLocaleTuples(text)
        }
      } catch (error) {
        warnings.push(`${file}: dictionary for ${namespace}: ${error.message}`)
        continue
      }
      if (!dictionary || typeof dictionary !== 'object') {
        warnings.push(`${file}: no English dictionary found for namespace "${namespace}"`)
        continue
      }

      if (namespaces[namespace]) {
        // A namespace's texts have one owner; keep the first and warn.
        warnings.push(`duplicate namespace "${namespace}" ignored at ${file}`)
        continue
      }
      namespaces[namespace] = {}
      for (const key of sortedKeys(dictionary)) namespaces[namespace][key] = String(dictionary[key])
      sources[namespace] = path.relative(root, file)
    }
  }

  const ordered = {}
  for (const namespace of sortedKeys(namespaces)) ordered[namespace] = namespaces[namespace]

  let keys = 0
  for (const dictionary of Object.values(ordered)) keys += Object.keys(dictionary).length

  return {
    version: 1,
    mode: 'source',
    root,
    harness: path.basename(root),
    harnessVersion: detected.harnessVersion,
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

/**
 * Scan a DeepSeek Harness installation and return the English catalog.
 *
 * The mode is autodetected from the path: a source checkout (`package.json` +
 * `packages/`) or a lightweight `~/.dsh` installation containing an
 * `@deepseek-ai` scope. Installed bundles are parsed statically and never
 * executed.
 *
 * @param {string} harnessRoot a checkout, a `~/.dsh` root or a scope path.
 * @returns {Promise<object>} the catalog plus `mode`, `root` and `harnessVersion`.
 */
export async function scanHarness(harnessRoot) {
  const detected = detectHarnessMode(harnessRoot)
  if (!detected) {
    throw new Error(
      `cannot locate a DeepSeek Harness checkout or installation at ${path.resolve(harnessRoot)}`,
    )
  }
  if (detected.mode === 'installed') return scanInstalledHarness(detected.root)
  return scanSourceHarness(detected)
}
