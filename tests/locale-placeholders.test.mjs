/**
 * Unit tests for placeholder extraction and preservation checks.
 * Fixtures only — no Harness checkout required.
 */
import assert from 'node:assert/strict'
import {
  assertPlaceholders,
  comparePlaceholders,
  countNamespacePlaceholders,
  extractPlaceholders,
  placeholderCounts,
} from '../tools/lib/placeholders.mjs'

assert.deepEqual(extractPlaceholders('Hello {name}, {count} items'), ['name', 'count'])
assert.deepEqual(extractPlaceholders('no placeholders here'), [])
assert.deepEqual(extractPlaceholders('{a}{b}{a}'), ['a', 'b', 'a'])
assert.deepEqual(extractPlaceholders('literal {{not}} braces'), ['not'])
assert.deepEqual(extractPlaceholders('code {snake_case} {with_underscore} {n1}'), [
  'snake_case',
  'with_underscore',
  'n1',
])
assert.deepEqual(extractPlaceholders(undefined), [])

assert.deepEqual(placeholderCounts('{a} {a} {b}'), { a: 2, b: 1 })
assert.deepEqual(comparePlaceholders('{a} {b}', '{a} {b}'), { ok: true, missing: [], extra: [] })
assert.deepEqual(comparePlaceholders('{count} items', 'items'), { ok: false, missing: ['count'], extra: [] })
assert.deepEqual(comparePlaceholders('{a}', '{a} {a}'), { ok: false, missing: [], extra: ['a'] })

assert.doesNotThrow(() => assertPlaceholders('key', 'Hello {name}', 'Hola {name}'))
assert.throws(() => assertPlaceholders('key', 'Hello {name}', 'Hola'), /placeholder mismatch/)
assert.throws(() => assertPlaceholders('key', 'Hello {name}', 'Hola {nombre}'), /missing name/)

assert.equal(
  countNamespacePlaceholders({ ns: { a: '{x}', b: '{y} {y}', c: 'none' } }),
  3,
)

console.log('placeholder unit tests: PASS')
