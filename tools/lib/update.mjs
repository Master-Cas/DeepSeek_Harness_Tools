/**
 * Catalog update: compare an existing language pack with the current English
 * scan, translate only genuinely new keys, keep every existing translation,
 * and report (or safely prune) obsolete keys.
 */

import path from 'node:path'
import { CATALOG_VERSION, normalizeCatalog, writeCatalog } from './catalog.mjs'
import { buildPluginFiles, planTranslationMemory, writePluginFiles } from './generate.mjs'
import { computeCoverage, percent, sortedKeys } from './util.mjs'

/** Structural diff between the current source and an existing target. */
export function diffCatalog(source, target) {
  const src = normalizeCatalog(source)
  const tgt = normalizeCatalog(target)
  const added = []
  const removed = []
  const shared = []

  for (const namespace of sortedKeys(src.namespaces)) {
    for (const key of sortedKeys(src.namespaces[namespace])) {
      if (Object.prototype.hasOwnProperty.call(tgt.namespaces?.[namespace] ?? {}, key)) {
        shared.push({ namespace, key })
      } else {
        added.push({ namespace, key, text: src.namespaces[namespace][key] })
      }
    }
  }
  for (const namespace of sortedKeys(tgt.namespaces)) {
    for (const key of sortedKeys(tgt.namespaces[namespace])) {
      if (!Object.prototype.hasOwnProperty.call(src.namespaces?.[namespace] ?? {}, key)) {
        removed.push({ namespace, key, value: tgt.namespaces[namespace][key] })
      }
    }
  }
  return {
    added,
    removed,
    shared,
    addedNamespaces: sortedKeys(src.namespaces).filter((ns) => !tgt.namespaces?.[ns]),
    removedNamespaces: sortedKeys(tgt.namespaces).filter((ns) => !src.namespaces?.[ns]),
  }
}

/**
 * Update a language pack against the current source.
 *
 * @param {object} options update options.
 * @param {object} options.source current English source catalog.
 * @param {object} [options.existing] existing target catalog.
 * @param {string} options.locale target locale.
 * @param {string} options.label target label.
 * @param {Function} [options.translate] translation runner.
 * @param {boolean} [options.noTranslate] copy English for new keys.
 * @param {boolean} [options.dryRun] report only.
 * @param {boolean} [options.prune] drop obsolete keys instead of reporting them.
 * @param {string} [options.catalogFile] catalog path to rewrite.
 * @param {object} [options.plugin] plugin regeneration info `{ outDir, name, id, version, description }`.
 * @returns {Promise<object>} update report.
 */
export async function updateLanguagePack(options) {
  const source = normalizeCatalog(options.source)
  const existing = normalizeCatalog(options.existing ?? { namespaces: {} })
  const diff = diffCatalog(source, existing)
  const { reused, pending } = planTranslationMemory(source, existing)
  const warnings = []

  const report = {
    dryRun: Boolean(options.dryRun),
    locale: options.locale,
    added: diff.added.length,
    removed: diff.removed.length,
    shared: diff.shared.length,
    reused: Object.values(reused).reduce((sum, dict) => sum + Object.keys(dict).length, 0),
    pending: pending.length,
    addedNamespaces: diff.addedNamespaces,
    removedNamespaces: diff.removedNamespaces,
    obsolete: diff.removed,
    obsoleteNamespaces: diff.removedNamespaces,
    warnings,
  }

  if (options.dryRun) {
    report.coverage = computeCoverage(source.namespaces, reused)
    return report
  }

  const translated = new Map()
  if (options.noTranslate) {
    for (const entry of pending) translated.set(entry.id, entry.text)
  } else if (pending.length) {
    if (typeof options.translate !== 'function') {
      throw new Error('no translation runner configured; pass --no-translate to copy English for new keys')
    }
    const result = await options.translate(pending)
    for (const entry of pending) {
      translated.set(entry.id, result.get(entry.id) ?? entry.text)
    }
  }

  const namespaces = {}
  for (const namespace of sortedKeys(source.namespaces)) {
    namespaces[namespace] = {}
    for (const key of sortedKeys(source.namespaces[namespace])) {
      const id = `${namespace}\u0000${key}`
      if (Object.prototype.hasOwnProperty.call(reused[namespace] ?? {}, key)) {
        namespaces[namespace][key] = reused[namespace][key]
      } else {
        namespaces[namespace][key] = translated.get(id) ?? source.namespaces[namespace][key]
      }
    }
  }

  // Obsolete entries: report by default, drop only under --prune.
  if (!options.prune) {
    for (const namespace of sortedKeys(existing.namespaces)) {
      if (source.namespaces[namespace]) continue
      namespaces[namespace] = { ...existing.namespaces[namespace], ...(namespaces[namespace] ?? {}) }
    }
    for (const entry of diff.removed) {
      if (source.namespaces[entry.namespace] && !Object.prototype.hasOwnProperty.call(namespaces[entry.namespace], entry.key)) {
        namespaces[entry.namespace][entry.key] = entry.value
      }
    }
    if (diff.removed.length) {
      for (const entry of diff.removed) warnings.push(`obsolete key kept: ${entry.namespace}.${entry.key}`)
    }
    for (const namespace of diff.removedNamespaces) warnings.push(`obsolete namespace kept: ${namespace}`)
  } else if (diff.removed.length) {
    for (const entry of diff.removed) warnings.push(`obsolete key pruned: ${entry.namespace}.${entry.key}`)
  }

  const ordered = {}
  for (const namespace of sortedKeys(namespaces)) ordered[namespace] = namespaces[namespace]

  const catalog = {
    version: CATALOG_VERSION,
    locale: options.locale,
    label: options.label,
    fallback: options.fallback ?? 'en',
    source: options.sourceRef ?? 'locales/source-en.json',
    namespaces: ordered,
  }

  if (options.catalogFile) writeCatalog(options.catalogFile, catalog)

  let pluginDir
  if (options.plugin?.dir && options.plugin?.name && options.plugin?.id) {
    const files = buildPluginFiles({
      name: options.plugin.name,
      id: options.plugin.id,
      version: options.plugin.version ?? '0.1.0',
      description: options.plugin.description,
      locale: options.locale,
      label: options.label,
      fallback: options.fallback ?? 'en',
      namespaces: ordered,
    })
    pluginDir = writePluginFiles(options.plugin.dir, files)
  }

  const coverage = computeCoverage(source.namespaces, ordered)
  report.catalog = catalog
  report.pluginDir = pluginDir
  report.coverage = coverage
  report.coverageRatio = percent(coverage.ratio)
  report.wrote = Boolean(options.catalogFile || pluginDir)
  return report
}
