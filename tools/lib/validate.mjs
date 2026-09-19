/**
 * Source/target catalog validation: namespaces, keys, placeholders, empty
 * translations and optional untranslated-key reporting. Produces a PASS/FAIL
 * verdict that the CLI turns into an exit code.
 */

import { normalizeCatalog } from './catalog.mjs'
import { comparePlaceholders } from './placeholders.mjs'
import { DEFAULT_PROTECTED_TERMS, findProtectedViolations } from './translate.mjs'
import { percent, sortedKeys } from './util.mjs'

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
  }
  const maxExamples = options.maxExamples ?? 25
  const protectedTerms = options.protectedTerms ?? DEFAULT_PROTECTED_TERMS

  let checked = 0
  let translated = 0

  for (const namespace of sortedKeys(src.namespaces)) {
    if (!Object.prototype.hasOwnProperty.call(tgt.namespaces, namespace)) {
      details.missingNamespaces.push(namespace)
      continue
    }
    for (const key of sortedKeys(src.namespaces[namespace])) {
      checked++
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
      const placeholders = comparePlaceholders(sourceValue, targetValue)
      if (!placeholders.ok) {
        const parts = []
        if (placeholders.missing.length) parts.push(`missing ${placeholders.missing.join(', ')}`)
        if (placeholders.extra.length) parts.push(`extra ${placeholders.extra.join(', ')}`)
        details.placeholderMismatches.push({ key: `${namespace}.${key}`, detail: parts.join('; ') })
      }
      if (sourceValue === targetValue) details.untranslated.push(`${namespace}.${key}`)
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
    },
    stats: {
      sourceNamespaces: Object.keys(src.namespaces).length,
      targetNamespaces: Object.keys(tgt.namespaces).length,
      sourceKeys: checked,
      translated,
      missing: details.missingKeys.length + details.missingNamespaces.length,
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
