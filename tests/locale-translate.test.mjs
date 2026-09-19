/**
 * Translation-engine tests against a mock OpenAI-compatible endpoint: JSON
 * batching, keyset validation, placeholder retry, credential safety.
 */
import assert from 'node:assert/strict'
import {
  TranslationError,
  batchEntries,
  loadGlossary,
  parseModelJson,
  resolveApiConfig,
  translateEntries,
} from '../tools/lib/translate.mjs'

/** Build a fake fetch returning `translations` for the requested ids. */
function mockFetch(handler) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    const request = JSON.parse(body.messages[1].content)
    calls.push({ url, body, request })
    const translations = handler(request, calls.length)
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ translations }) } }] }),
      text: async () => '',
    }
  }
  return { fetchImpl, calls }
}

const entries = [
  { id: 'ns\u0000a', namespace: 'ns', key: 'a', text: 'Hello {name}' },
  { id: 'ns\u0000b', namespace: 'ns', key: 'b', text: 'Two' },
  { id: 'ns\u0000c', namespace: 'ns', key: 'c', text: 'Three {n}' },
]

// Happy path, two batches.
{
  const { fetchImpl, calls } = mockFetch((request) =>
    Object.fromEntries(request.id.map((entry) => [entry.id, `${entry.text} translated`])),
  )
  const result = await translateEntries({
    entries,
    targetLocale: 'xx',
    config: { apiKey: 'test', apiUrl: 'http://mock', model: 'mock' },
    fetchImpl,
    batchSize: 2,
    protectedTerms: [],
  })
  assert.equal(result.size, 3)
  assert.equal(result.get('ns\u0000a'), 'Hello {name} translated')
  assert.equal(calls.length, 2, 'batch size 2 must produce two requests')
  assert.ok(!JSON.stringify(calls).includes('"apiKey"'))
}

// Placeholder break on the first attempt, repaired on retry.
{
  let attempt = 0
  const { fetchImpl, calls } = mockFetch((request) => {
    attempt++
    return Object.fromEntries(
      request.id.map((entry) => [entry.id, attempt === 1 ? 'Hola' : `Hola ${'{name}'}`]),
    )
  })
  const result = await translateEntries({
    entries: [entries[0]],
    targetLocale: 'es',
    config: { apiKey: 'test', apiUrl: 'http://mock', model: 'mock' },
    fetchImpl,
    protectedTerms: [],
  })
  assert.equal(result.get('ns\u0000a'), 'Hola {name}')
  assert.equal(calls.length, 2, 'placeholder mismatch must retry once')
  assert.ok(calls[1].body.messages[1].content.includes('previous_validation_problems'))
}

// Keyset break (extra id) forces a retry.
{
  let attempt = 0
  const { fetchImpl, calls } = mockFetch((request) => {
    attempt++
    const map = Object.fromEntries(request.id.map((entry) => [entry.id, entry.text]))
    if (attempt === 1) map['999'] = 'intruder'
    return map
  })
  const result = await translateEntries({
    entries: [entries[1]],
    targetLocale: 'es',
    config: { apiKey: 'test', apiUrl: 'http://mock', model: 'mock' },
    fetchImpl,
    protectedTerms: [],
  })
  assert.equal(result.get('ns\u0000b'), 'Two')
  assert.equal(calls.length, 2)
}

// A batch that never validates is copied from English in lenient mode.
{
  const { fetchImpl } = mockFetch((request) =>
    Object.fromEntries(request.id.map((entry) => [entry.id, 'broken'])),
  )
  const result = await translateEntries({
    entries: [entries[0]],
    targetLocale: 'es',
    config: { apiKey: 'test', apiUrl: 'http://mock', model: 'mock' },
    fetchImpl,
    maxRetries: 1,
    protectedTerms: [],
    onUnresolved: 'copy',
  })
  assert.equal(result.get('ns\u0000a'), 'Hello {name}')
}

// Strict mode throws after exhausting retries.
{
  const { fetchImpl } = mockFetch((request) =>
    Object.fromEntries(request.id.map((entry) => [entry.id, 'broken'])),
  )
  await assert.rejects(
    translateEntries({
      entries: [entries[0]],
      targetLocale: 'es',
      config: { apiKey: 'test', apiUrl: 'http://mock', model: 'mock' },
      fetchImpl,
      maxRetries: 1,
      protectedTerms: [],
    }),
    (error) => error instanceof TranslationError,
  )
}

// Missing credential fails clearly and never echoes a key.
{
  const saved = process.env.DEEPSEEK_API_KEY
  const savedExplicit = process.env.DSH_LOCALE_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.DSH_LOCALE_API_KEY
  await assert.rejects(
    translateEntries({
      entries: [entries[0]],
      targetLocale: 'es',
      config: resolveApiConfig({}),
      fetchImpl: async () => {
        throw new Error('should not be called')
      },
    }),
    (error) => error instanceof TranslationError && /DEEPSEEK_API_KEY/.test(error.message),
  )
  if (saved === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = saved
  if (savedExplicit === undefined) delete process.env.DSH_LOCALE_API_KEY
  else process.env.DSH_LOCALE_API_KEY = savedExplicit
}

// A transport error carrying the credential is redacted.
{
  const secret = 'sk-verysecretvalue1234567890'
  await assert.rejects(
    translateEntries({
      entries: [entries[0]],
      targetLocale: 'es',
      config: { apiKey: secret, apiUrl: 'http://mock', model: 'mock' },
      fetchImpl: async () => {
        throw new Error(`connection failed for Bearer ${secret}`)
      },
    }),
    (error) => !error.message.includes(secret) && error.message.includes('[REDACTED]'),
  )
}

// Response parsing tolerates fenced JSON.
assert.deepEqual(parseModelJson('```json\n{"translations":{"0":"x"}}\n```'), { translations: { '0': 'x' } })
assert.deepEqual(parseModelJson('prefix {"a":1} suffix'), { a: 1 })

// Batching and glossary helpers.
const batches = batchEntries(
  Array.from({ length: 5 }, (_, i) => ({ id: String(i), text: `text ${i}` })),
  { batchSize: 2 },
)
assert.deepEqual(batches.map((batch) => batch.length), [2, 2, 1])
const loaded = loadGlossary({ glossary: { Deploy: 'Desplegar' }, protected: ['Kubernetes'], terms: { Run: 'Ejecutar' } })
assert.equal(loaded.glossary.Deploy, 'Desplegar')
assert.equal(loaded.glossary.Run, 'Ejecutar')
assert.ok(loaded.protectedTerms.includes('Kubernetes'))
assert.ok(loaded.protectedTerms.includes('JSON'))

console.log('translation tests: PASS')
