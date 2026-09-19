/**
 * Canonical locale-catalog format used by `locales/source-en.json` and
 * `locales/<locale>.json`, plus helpers to import an existing Harness
 * language-pack `client.js` without losing a single translation.
 */

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { sortedKeys, writeJson } from './util.mjs'

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
 * Read every dictionary and the language definition out of a Harness
 * language-pack `client.js`. The module registers through
 * `window.__ModuleLoader__`, so it is evaluated in an isolated VM context
 * with a mock locale service — no Harness runtime required.
 *
 * @param {string} file path to the pack's `client.js`.
 * @returns {{ id: string, locale: string|undefined, label: string|undefined, fallback: string|undefined, namespaces: Record<string, Record<string,string>> }}
 */
export function catalogFromPlugin(file) {
  const source = fs.readFileSync(file, 'utf8')
  let registration
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value) {
          registration = value
        },
      },
    },
    console,
  }
  vm.runInNewContext(source, sandbox, { filename: file })
  if (!registration) throw new Error(`${file} did not register with window.__ModuleLoader__`)

  let language
  const byLocale = new Map()
  const plugin = registration.factory()
  const ctx = {
    locale: {
      addLanguage(value) {
        language = value
        return () => {}
      },
      register(namespace, locale, dictionary) {
        if (!byLocale.has(locale)) byLocale.set(locale, {})
        byLocale.get(locale)[namespace] = dictionary
        return () => {}
      },
    },
    effect(effect) {
      effect()
    },
  }
  plugin.apply(ctx)

  const targetLocale =
    (language?.id && byLocale.has(language.id) ? language.id : undefined) ??
    [...byLocale.keys()].find((id) => id !== 'en') ??
    [...byLocale.keys()][0]
  const namespaces = byLocale.get(targetLocale) ?? {}

  const clean = {}
  for (const namespace of sortedKeys(namespaces)) {
    clean[namespace] = {}
    for (const key of sortedKeys(namespaces[namespace])) {
      clean[namespace][key] = String(namespaces[namespace][key])
    }
  }
  return {
    id: registration.id,
    locale: language?.id ?? targetLocale,
    label: language?.label,
    fallback: language?.fallback,
    namespaces: clean,
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
  return path.join(root, 'locales', `${locale}.json`)
}

/** Resolve the canonical English source path inside a repository. */
export function sourceCatalogPath(root) {
  return path.join(root, 'locales', 'source-en.json')
}
