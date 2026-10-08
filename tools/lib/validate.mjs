/**
 * Source/target catalog validation: namespaces, keys, placeholders, empty
 * translations and optional untranslated-key reporting. Produces a PASS/FAIL
 * verdict that the CLI turns into an exit code.
 */

import { normalizeCatalog } from './catalog.mjs'
import { comparePlaceholders } from './placeholders.mjs'
import { DEFAULT_PROTECTED_TERMS, findProtectedViolations } from './translate.mjs'
import { hash, percent, sortedKeys } from './util.mjs'

/**
 * Validate a target catalog against its source.
 *
 * @param {object} source source catalog.
 * @param {object} target target catalog.
 * @param {object} [options] validation options.
 * @param {boolean} [options.strict] treat extra namespaces/keys and untranslated strings as errors.
 * @param {boolean} [options.checkProtected] report lost protected terms.
 * @param {string[]} [options.protectedTerms] protected term list.
 * @param {number} [options.maxExamples] examples per error category.
 * @returns {{ pass: boolean, errors: string[], warnings: string[], stats: object, details: object }}
 */
function legitimateIdenticalSource(value, protectedTerms) {
  const text = String(value ?? '').trim()
  if (!text) return false
  if (protectedTerms.includes(text)) return true
  if (/^--?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) return true
  if (/^(?:https?:\/\/|[A-Za-z]:\\|\/)[^\s]+$/.test(text)) return true
  return false
}

export function validateCatalogs(source, target, options = {}) {
  const src = normalizeCatalog(source)
  const tgt = normalizeCatalog(target)
  const errors = []
  const warnings = []
  const details = {
    missingNamespaces: [],
    extraNamespaces: [],
    missingKeys: [],
    extraKeys: [],
    placeholderMismatches: [],
    emptyTranslations: [],
    untranslated: [],
    protectedViolations: [],
    staleTranslations: [],
    unverifiedSourceHashes: [],
  }
  const maxExamples = options.maxExamples ?? 25
  const protectedTerms = options.protectedTerms ?? DEFAULT_PROTECTED_TERMS
  const sourceHashes = tgt.meta?.sourceHashes ?? {}
  const legacyUnverified = new Set(tgt.meta?.legacyUnverified ?? [])

  let checked = Object.values(src.namespaces).reduce((sum, dict) => sum + Object.keys(dict).length, 0)
  let translated = 0

  for (const namespace of sortedKeys(src.namespaces)) {
    if (!Object.prototype.hasOwnProperty.call(tgt.namespaces, namespace)) {
      details.missingNamespaces.push(namespace)
      continue
    }
    for (const key of sortedKeys(src.namespaces[namespace])) {
      const sourceValue = src.namespaces[namespace][key]
      const targetValue = tgt.namespaces[namespace][key]
      if (typeof targetValue !== 'string') {
        details.missingKeys.push(`${namespace}.${key}`)
        continue
      }
      if (targetValue === '') {
        details.emptyTranslations.push(`${namespace}.${key}`)
        continue
      }
      translated++
      const sourceId = `${namespace}\u0000${key}`
      const recordedHash = sourceHashes?.[namespace]?.[key]
      const currentHash = hash(String(sourceValue))
      if (typeof recordedHash === 'string' && recordedHash !== currentHash) {
        details.staleTranslations.push(`${namespace}.${key}`)
      } else if (typeof recordedHash !== 'string' || legacyUnverified.has(sourceId)) {
        details.unverifiedSourceHashes.push(`${namespace}.${key}`)
      }
      const placeholders = comparePlaceholders(sourceValue, targetValue)
      if (!placeholders.ok) {
        const parts = []
        if (placeholders.missing.length) parts.push(`missing ${placeholders.missing.join(', ')}`)
        if (placeholders.extra.length) parts.push(`extra ${placeholders.extra.join(', ')}`)
        details.placeholderMismatches.push({ key: `${namespace}.${key}`, detail: parts.join('; ') })
      }
      if (sourceValue === targetValue && !legitimateIdenticalSource(sourceValue, protectedTerms)) {
        details.untranslated.push(`${namespace}.${key}`)
      }
      if (options.checkProtected) {
        const violations = findProtectedViolations(sourceValue, targetValue, protectedTerms)
        if (violations.length) {
          details.protectedViolations.push(`${namespace}.${key}: ${violations.join(', ')}`)
        }
      }
    }
    for (const key of sortedKeys(tgt.namespaces[namespace])) {
      if (!Object.prototype.hasOwnProperty.call(src.namespaces[namespace], key)) {
        details.extraKeys.push(`${namespace}.${key}`)
      }
    }
  }
  for (const namespace of sortedKeys(tgt.namespaces)) {
    if (!Object.prototype.hasOwnProperty.call(src.namespaces, namespace)) {
      details.extraNamespaces.push(namespace)
    }
  }

  for (const namespace of details.missingNamespaces) errors.push(`missing namespace "${namespace}"`)
  for (const key of details.missingKeys) errors.push(`missing key "${key}"`)
  for (const key of details.emptyTranslations) errors.push(`empty translation "${key}"`)
  for (const entry of details.placeholderMismatches) {
    errors.push(`placeholder mismatch "${entry.key}": ${entry.detail}`)
  }
  for (const key of details.staleTranslations) errors.push(`stale translation "${key}": English source changed`)
  if (details.unverifiedSourceHashes.length) {
    warnings.push(`${details.unverifiedSourceHashes.length} translation(s) have no verified historical source hash`)
  }

  for (const namespace of details.extraNamespaces) {
    const message = `extra namespace "${namespace}" not present in source`
    if (options.strict) errors.push(message)
    else warnings.push(message)
  }
  for (const key of details.extraKeys) {
    const message = `extra key "${key}" not present in source`
    if (options.strict) errors.push(message)
    else warnings.push(message)
  }
  if (details.untranslated.length) {
    const message = `${details.untranslated.length} value(s) identical to source (untranslated)`
    if (options.strict) errors.push(message)
    else warnings.push(message)
  }
  for (const entry of details.protectedViolations) warnings.push(`protected term lost in "${entry}"`)

  const limit = (list) => list.slice(0, maxExamples)
  return {
    pass: errors.length === 0,
    errors,
    warnings,
    details: {
      ...details,
      missingNamespaces: limit(details.missingNamespaces),
      missingKeys: limit(details.missingKeys),
      extraKeys: limit(details.extraKeys),
      placeholderMismatches: limit(details.placeholderMismatches),
      emptyTranslations: limit(details.emptyTranslations),
      untranslated: limit(details.untranslated),
      protectedViolations: limit(details.protectedViolations),
      staleTranslations: limit(details.staleTranslations),
      unverifiedSourceHashes: limit(details.unverifiedSourceHashes),
    },
    stats: {
      sourceNamespaces: Object.keys(src.namespaces).length,
      targetNamespaces: Object.keys(tgt.namespaces).length,
      sourceKeys: checked,
      translated,
      missing: checked - translated,
      extraKeys: details.extraKeys.length,
      coverage: percent(checked === 0 ? 1 : translated / checked),
    },
  }
}

/** Render a human-readable validation report. */
export function formatValidationReport(report) {
  const lines = []
  lines.push(`Validation: ${report.pass ? 'PASS' : 'FAIL'}`)
  lines.push(
    `  namespaces ${report.stats.targetNamespaces}/${report.stats.sourceNamespaces} · ` +
      `keys ${report.stats.translated}/${report.stats.sourceKeys} · coverage ${report.stats.coverage}`,
  )
  for (const error of report.errors) lines.push(`  ERROR   ${error}`)
  for (const warning of report.warnings) lines.push(`  WARNING ${warning}`)
  return lines.join('\n')
}
