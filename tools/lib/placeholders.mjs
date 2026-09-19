/**
 * Placeholder handling for locale templates. Harness templates use `{name}`
 * tokens that the runtime substitutes verbatim; a translation must carry the
 * exact same tokens or the rendered string breaks. This module is the single
 * source of truth for extraction, comparison and repair checks.
 */

/** Matches a single `{name}` placeholder as the Harness runtime does. */
export const PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]+)\}/g

/**
 * Extract placeholder names in appearance order.
 * @param {unknown} value template value.
 * @returns {string[]} placeholder names (possibly empty).
 */
export function extractPlaceholders(value) {
  const text = String(value ?? '')
  const names = []
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) names.push(match[1])
  return names
}

/**
 * Group placeholders with their occurrence counts.
 * @param {unknown} value template value.
 * @returns {Record<string, number>} name to occurrence count.
 */
export function placeholderCounts(value) {
  const counts = {}
  for (const name of extractPlaceholders(value)) counts[name] = (counts[name] ?? 0) + 1
  return counts
}

/**
 * Compare two placeholder multisets.
 * @param {unknown} source source template.
 * @param {unknown} target target template.
 * @returns {{ ok: boolean, missing: string[], extra: string[] }} comparison.
 */
export function comparePlaceholders(source, target) {
  const a = placeholderCounts(source)
  const b = placeholderCounts(target)
  const names = new Set([...Object.keys(a), ...Object.keys(b)])
  const missing = []
  const extra = []
  for (const name of names) {
    const want = a[name] ?? 0
    const got = b[name] ?? 0
    if (got < want) missing.push(name)
    if (got > want) extra.push(name)
  }
  return { ok: missing.length === 0 && extra.length === 0, missing, extra }
}

/**
 * Assert that a translation keeps every placeholder of its source.
 * @param {string} key dictionary key, for the error message.
 * @param {unknown} source source template.
 * @param {unknown} target candidate translation.
 * @throws when a placeholder is missing or duplicated.
 */
export function assertPlaceholders(key, source, target) {
  const result = comparePlaceholders(source, target)
  if (!result.ok) {
    const parts = []
    if (result.missing.length) parts.push(`missing ${result.missing.join(', ')}`)
    if (result.extra.length) parts.push(`unexpected ${result.extra.join(', ')}`)
    throw new Error(`placeholder mismatch for "${key}": ${parts.join('; ')}`)
  }
}

/** Count every placeholder occurrence across a namespace map. */
export function countNamespacePlaceholders(namespaceMap) {
  let total = 0
  for (const dictionary of Object.values(namespaceMap ?? {})) {
    for (const value of Object.values(dictionary ?? {})) total += extractPlaceholders(value).length
  }
  return total
}
