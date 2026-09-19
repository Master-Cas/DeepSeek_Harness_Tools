/**
 * Dynamic Harness locale discovery.
 *
 * The scanner never hardcodes a namespace list. It walks the Harness source
 * tree, finds every `ctx.locale.register(...)` call, resolves the namespace
 * expression and the English dictionary expression, and loads the dictionary
 * module so values and placeholders are exact. Registration forms covered:
 *
 *   register(NS, { zh, en })                 // typed bilingual form
 *   register(NS, { zh: zhX, en: enX })       // aliased imports
 *   register('literal.ns', { zh, en })       // inline namespace literal
 *   register(NS, locale, dict)               // one locale per call
 *
 * Namespaces and dictionaries are discovered from source; dictionary values
 * are imported. The source `.ts` modules are preferred (Node >= 22.6 strips
 * TypeScript types), with the compiled `lib/types/**` ESM as a fallback.
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { countNamespacePlaceholders } from './placeholders.mjs'
import { hash, sortedKeys } from './util.mjs'

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

/** Extract the balanced `(...)`, `{...}` or `[...]` starting at `start`. */
export function extractBalanced(text, start) {
  const open = text[start]
  const close = open === '(' ? ')' : open === '{' ? '}' : open === '[' ? ']' : undefined
  if (!close) return undefined
  let depth = 0
  let quote
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === '\\') {
        i++
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === open) depth++
    else if (char === close) {
      depth--
      if (depth === 0) return { text: text.slice(start, i + 1), end: i }
    }
  }
  return undefined
}

/** Split a call/object body on top-level commas. */
export function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let quote
  let current = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      current += char
      if (char === '\\') {
        current += text[++i]
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === '(' || char === '{' || char === '[') depth++
    if (char === ')' || char === '}' || char === ']') depth--
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** Locate every `locale.register(...)` call outside comments. */
export function findRegisterCalls(text) {
  const calls = []
  const pattern = /locale\.register\s*\(/g
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(0, match.index)
    const lineStart = before.lastIndexOf('\n') + 1
    const line = text.slice(lineStart, match.index).trimStart()
    if (line.startsWith('*') || line.startsWith('//')) continue
    const open = match.index + match[0].length - 1
    const balanced = extractBalanced(text, open)
    if (!balanced) continue
    calls.push({
      index: match.index,
      args: splitTopLevel(balanced.text.slice(1, -1)),
      body: balanced.text.slice(1, -1),
    })
  }
  return calls
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
 * Scan a Harness checkout and return the English catalog.
 * @param {string} harnessRoot absolute path to the checkout.
 * @returns {Promise<{ version: number, harness: string, namespaces: Record<string, Record<string, string>>, stats: object, warnings: string[] }>}
 */
export async function scanHarness(harnessRoot) {
  const root = path.resolve(harnessRoot)
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
    harness: path.basename(root),
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
