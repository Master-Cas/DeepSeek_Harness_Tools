/**
 * Canonical locale-catalog format used by `locales/source-en.json` and
 * `locales/<locale>.json`, plus helpers to import an existing Harness
 * language-pack `client.js` without losing a single translation.
 */

import fs from 'node:fs'
import path from 'node:path'
import { sortedKeys, writeJson } from './util.mjs'
import {
  collectDeclarations,
  evaluateStatic,
  extractBalanced,
  findRegisterCalls,
  parseStringLiteral,
  stripComments,
} from './static-js.mjs'

/** Current catalog schema version. */
export const CATALOG_VERSION = 1

/** True when the value looks like a catalog object with a `namespaces` map. */
function hasNamespaceMap(value) {
  return Boolean(value) && typeof value === 'object' && value.namespaces && typeof value.namespaces === 'object'
}

/**
 * Normalize a raw JSON catalog or a bare `{ ns: dict }` map.
 * @param {object} raw parsed JSON.
 * @param {object} [defaults] fallback locale metadata.
 * @returns {{ version: number, locale: string, label: string, fallback: string|null, source: string|null, namespaces: Record<string, Record<string,string>>, meta: object }}
 */
export function normalizeCatalog(raw, defaults = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('catalog must be a JSON object')
  const namespaces = hasNamespaceMap(raw) ? raw.namespaces : raw
  const clean = {}
  for (const namespace of sortedKeys(namespaces)) {
    const dictionary = namespaces[namespace]
    if (!dictionary || typeof dictionary !== 'object') continue
    clean[namespace] = {}
    for (const key of sortedKeys(dictionary)) clean[namespace][key] = String(dictionary[key])
  }
  return {
    version: raw.version ?? CATALOG_VERSION,
    locale: raw.locale ?? defaults.locale ?? 'en',
    label: raw.label ?? defaults.label ?? 'English',
    fallback: raw.fallback ?? defaults.fallback ?? null,
    source: raw.source ?? defaults.source ?? null,
    namespaces: clean,
    meta: { ...(raw.meta ?? {}), ...(defaults.meta ?? {}) },
  }
}

/** Convert a `scanHarness()` result into a catalog. */
export function catalogFromScan(scan, defaults = {}) {
  return normalizeCatalog(
    {
      version: CATALOG_VERSION,
      locale: defaults.locale ?? 'en',
      label: defaults.label ?? 'English',
      fallback: null,
      namespaces: scan.namespaces,
      meta: { harness: scan.harness, stats: scan.stats },
    },
    defaults,
  )
}

/** Load a catalog from disk. */
export function loadCatalog(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return normalizeCatalog(raw)
}

/**
 * Maximum client.js size accepted by the static importer. Language packs are
 * tiny compared with this ceiling; the bound prevents accidental memory abuse.
 */
const MAX_PLUGIN_BYTES = 5 * 1024 * 1024
const MAX_PLUGIN_NAMESPACES = 5000
const MAX_PLUGIN_KEYS = 200000

/** Return the arguments of the first call matching `pattern`. */
function firstCallArgs(text, pattern) {
  const match = pattern.exec(text)
  if (!match) return undefined
  const open = text.indexOf('(', match.index)
  const balanced = extractBalanced(text, open)
  if (!balanced) throw new Error('malformed JavaScript: unterminated call expression')
  return balanced.text.slice(1, -1).trim()
}

function codeOutsideStrings(text) {
  let out = ''
  let quote
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === '\\') { i++; out += '  '; continue }
      if (char === quote) quote = undefined
      out += ' '
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; out += ' '; continue }
    out += char
  }
  return out
}

/** Ensure a recovered dictionary is plain string data and enforce size bounds. */
function normalizeStaticNamespaces(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out = {}
  let keys = 0
  for (const namespace of sortedKeys(value)) {
    const dictionary = value[namespace]
    if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) {
      throw new Error(`unsupported dynamic dictionary for namespace "${namespace}"`)
    }
    out[namespace] = {}
    for (const key of sortedKeys(dictionary)) {
      const entry = dictionary[key]
      if (typeof entry !== 'string') {
        throw new Error(`unsupported non-string translation at "${namespace}.${key}"`)
      }
      out[namespace][key] = entry
      keys++
      if (keys > MAX_PLUGIN_KEYS) throw new Error('plugin catalog exceeds the maximum key count')
    }
    if (Object.keys(out).length > MAX_PLUGIN_NAMESPACES) {
      throw new Error('plugin catalog exceeds the maximum namespace count')
    }
  }
  return out
}

/**
 * Read a Harness language-pack `client.js` as inert text.
 *
 * Supported shapes are deliberately narrow:
 *   - generated packs with a static `const dictionaries = { ... }` followed by
 *     `Object.entries(dictionaries)` registration;
 *   - explicit static `locale.register(namespace, locale, dictionary)` calls;
 *   - static `locale.register(namespace, { en, xx })` option objects.
 *
 * No JavaScript is executed. Unknown/dynamic constructs fail closed.
 */
export function catalogFromPlugin(file) {
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw new Error(`${file} is not a regular file`)
  if (stat.size > MAX_PLUGIN_BYTES) throw new Error(`${file} exceeds the static import size limit`)

  const raw = fs.readFileSync(file, 'utf8')
  const text = stripComments(raw)
  const symbols = collectDeclarations(text)

  let id
  const loadArgs = firstCallArgs(text, /(?:window\.)?__ModuleLoader__\.load\s*\(/)
  if (loadArgs) {
    const registration = evaluateStatic(loadArgs, symbols)
    if (registration && typeof registration.id === 'string') id = registration.id
    if (!id) {
      const match = /\bid\s*:\s*(["'][\s\S]*?["'])/.exec(loadArgs)
      if (match) id = parseStringLiteral(match[1])
    }
  }
  if (!id) throw new Error(`${file} has no statically resolvable module id`)

  let language
  const languageArgs = firstCallArgs(text, /locale\.addLanguage\s*\(/)
  if (languageArgs) {
    const value = evaluateStatic(languageArgs, symbols)
    if (value && typeof value === 'object' && !Array.isArray(value)) language = value
  }

  let targetLocale = typeof language?.id === 'string' ? language.id : undefined
  let namespaces

  if (
    symbols.has('dictionaries') &&
    /Object\.entries\s*\(\s*dictionaries\s*\)/.test(text) &&
    /locale\.register\s*\(/.test(text)
  ) {
    const expression = symbols.get('dictionaries')
    const structural = codeOutsideStrings(expression)
    if (/=>|\bnew\s|\bawait\b|\byield\b|\bfunction\b|\b[A-Za-z_$][\w$]*\s*\(/.test(structural)) {
      throw new Error(`${file} uses dynamic dictionary expressions that cannot be imported safely`)
    }
    namespaces = normalizeStaticNamespaces(evaluateStatic(expression, symbols))
  }

  const direct = {}
  for (const call of findRegisterCalls(text)) {
    const [nsArg, second, third] = call.args
    const namespace = evaluateStatic(nsArg, symbols)
    if (typeof namespace !== 'string') continue
    if (third) {
      const locale = evaluateStatic(second, symbols)
      if (typeof locale !== 'string') continue
      if (!targetLocale && locale !== 'en') targetLocale = locale
      if (targetLocale && locale !== targetLocale) continue
      const dictionary = evaluateStatic(third, symbols)
      if (dictionary && typeof dictionary === 'object' && !Array.isArray(dictionary)) {
        direct[namespace] = dictionary
      }
      continue
    }
    const options = evaluateStatic(second, symbols)
    if (!options || typeof options !== 'object' || Array.isArray(options)) continue
    const locale = targetLocale ?? Object.keys(options).find((key) => key !== 'en') ?? 'en'
    if (!targetLocale && locale !== 'en') targetLocale = locale
    const dictionary = options[locale]
    if (dictionary && typeof dictionary === 'object' && !Array.isArray(dictionary)) {
      direct[namespace] = dictionary
    }
  }
  if (Object.keys(direct).length) {
    namespaces = { ...(namespaces ?? {}), ...normalizeStaticNamespaces(direct) }
  }

  if (!namespaces || Object.keys(namespaces).length === 0) {
    throw new Error(`${file} contains no supported static locale dictionaries`)
  }

  return {
    id,
    locale: typeof language?.id === 'string' ? language.id : targetLocale,
    label: typeof language?.label === 'string' ? language.label : undefined,
    fallback: typeof language?.fallback === 'string' ? language.fallback : undefined,
    namespaces,
  }
}

/** Persist a catalog with a stable trailing newline. */
export function writeCatalog(file, catalog) {
  const normalized = normalizeCatalog(catalog)
  writeJson(file, {
    version: normalized.version,
    locale: normalized.locale,
    label: normalized.label,
    ...(normalized.fallback ? { fallback: normalized.fallback } : {}),
    ...(normalized.source ? { source: normalized.source } : {}),
    namespaces: normalized.namespaces,
    ...(normalized.meta && Object.keys(normalized.meta).length ? { meta: normalized.meta } : {}),
  })
}

/** Count namespaces, keys and placeholders in a catalog. */
export function catalogStats(catalog) {
  const normalized = normalizeCatalog(catalog)
  let keys = 0
  let empty = 0
  let placeholders = 0
  for (const dictionary of Object.values(normalized.namespaces)) {
    for (const value of Object.values(dictionary)) {
      keys++
      if (value === '') empty++
      placeholders += (String(value).match(/\{[A-Za-z0-9_]+\}/g) ?? []).length
    }
  }
  return { namespaces: Object.keys(normalized.namespaces).length, keys, empty, placeholders }
}

/** Resolve the canonical catalog path inside a repository. */
export function catalogPath(root, locale) {
  if (typeof locale !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) {
    throw new Error('invalid locale identifier')
  }
  return path.join(root, 'locales', `${locale}.json`)
}

/** Resolve the canonical English source path inside a repository. */
export function sourceCatalogPath(root) {
  return path.join(root, 'locales', 'source-en.json')
}
