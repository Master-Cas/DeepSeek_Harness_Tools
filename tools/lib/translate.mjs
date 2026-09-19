/**
 * Automatic translation through any OpenAI-compatible chat-completions API.
 *
 * Configuration (never logged, never persisted):
 *   DEEPSEEK_API_KEY    default credential
 *   DSH_LOCALE_API_KEY  explicit credential override
 *   DSH_LOCALE_API_URL  endpoint (default https://api.deepseek.com/v1/chat/completions)
 *   DSH_LOCALE_MODEL    model id (default deepseek-chat)
 *
 * Requests are JSON batches. A batch is accepted only when its keyset matches
 * the request and every `{placeholder}` survives; otherwise the batch is
 * retried with the validation feedback attached.
 */

import { comparePlaceholders } from './placeholders.mjs'
import { redact } from './util.mjs'

/** Default OpenAI-compatible endpoint. */
export const DEFAULT_API_URL = 'https://api.deepseek.com/v1/chat/completions'

/** Default model id. */
export const DEFAULT_MODEL = 'deepseek-chat'

/** Technical vocabulary that should survive translation verbatim. */
export const DEFAULT_PROTECTED_TERMS = [
  'API', 'CLI', 'JSON', 'YAML', 'TOML', 'HTTP', 'HTTPS', 'URL', 'URI', 'HTML', 'CSS', 'XML',
  'SQL', 'SDK', 'SSH', 'Git', 'GitHub', 'GitLab', 'npm', 'pnpm', 'Node.js', 'JavaScript',
  'TypeScript', 'Python', 'Docker', 'Kubernetes', 'Linux', 'macOS', 'Windows', 'WebSocket',
  'RPC', 'MCP', 'UUID', 'JWT', 'OAuth', 'CSV', 'TSV', 'PDF', 'PNG', 'JPEG', 'SVG', 'ZIP',
  'UTF-8', 'POSIX', 'TTY', 'PTY', 'PID', 'CPU', 'RAM', 'GPU', 'LLM', 'UI', 'UX', 'Markdown',
  'README', 'DeepSeek', 'Harness', 'VS Code',
]

/** Resolve API configuration, preferring explicit option over environment. */
export function resolveApiConfig(options = {}) {
  const apiKey = options.apiKey ?? process.env.DSH_LOCALE_API_KEY ?? process.env.DEEPSEEK_API_KEY
  const apiUrl = options.apiUrl ?? process.env.DSH_LOCALE_API_URL ?? DEFAULT_API_URL
  const model = options.model ?? process.env.DSH_LOCALE_MODEL ?? DEFAULT_MODEL
  return { apiKey, apiUrl, model }
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Terms that appear in `source` and must therefore appear in `target`. */
export function protectedTermsInSource(source, terms = DEFAULT_PROTECTED_TERMS) {
  const text = String(source ?? '')
  return terms.filter((term) => new RegExp(`(^|[^\\w])${escapeRegExp(term)}([^\\w]|$)`).test(text))
}

/** Report protected terms present in the source but absent from the target. */
export function findProtectedViolations(source, target, terms = DEFAULT_PROTECTED_TERMS) {
  const required = protectedTermsInSource(source, terms)
  return required.filter((term) => {
    const pattern = new RegExp(`(^|[^\\w])${escapeRegExp(term)}([^\\w]|$)`)
    return !pattern.test(String(target ?? ''))
  })
}

/** Build the system prompt for one batch. */
function buildPrompt({ sourceLocale, targetLocale, glossary, protectedTerms }) {
  const lines = [
    `You are a professional UI localizer translating software interface strings from ${sourceLocale} to ${targetLocale}.`,
    'Return ONLY a JSON object of the exact shape {"translations":{"<id>":"<translated text>"}}.',
    'Include every supplied id exactly once and do not add extra ids.',
    'Preserve every {placeholder} token exactly as it appears, including braces and spelling; never translate, reorder or drop placeholders.',
    'Preserve leading/trailing punctuation, ellipses, and whitespace semantics.',
    'Never translate code, file paths, URLs, or CLI flags.',
  ]
  const glossaryEntries = Object.entries(glossary ?? {})
  if (glossaryEntries.length) {
    lines.push(`Use this glossary (source -> target): ${JSON.stringify(glossary)}.`)
  }
  if (protectedTerms?.length) {
    lines.push(`Keep these technical terms unchanged: ${protectedTerms.join(', ')}.`)
  }
  return lines.join(' ')
}

/** Extract a JSON object from a model response, tolerating fenced output. */
export function parseModelJson(content) {
  if (typeof content !== 'string') throw new Error('model response content is not text')
  const trimmed = content.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = fenced ? fenced[1] : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('model response has no JSON object')
  return JSON.parse(candidate.slice(start, end + 1))
}

/** Split entries into batches bounded by count and characters. */
export function batchEntries(entries, { batchSize = 40, maxChars = 6000 } = {}) {
  const batches = []
  let current = []
  let chars = 0
  for (const entry of entries) {
    const size = String(entry.text).length + String(entry.namespace ?? entry.ns ?? '').length + 32
    if (current.length && (current.length >= batchSize || chars + size > maxChars)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(entry)
    chars += size
  }
  if (current.length) batches.push(current)
  return batches
}

/** Validate one batch response against its request. */
export function validateBatch(batch, translations, { glossary, protectedTerms } = {}) {
  const problems = []
  const expected = new Set(batch.map((entry) => entry.id))
  for (const id of Object.keys(translations)) {
    if (!expected.has(id)) problems.push(`unexpected id "${id}"`)
  }
  for (const entry of batch) {
    const value = translations[entry.id]
    if (typeof value !== 'string' || value === '') {
      problems.push(`missing or empty translation for id "${entry.id}"`)
      continue
    }
    const placeholders = comparePlaceholders(entry.text, value)
    if (!placeholders.ok) {
      const detail = []
      if (placeholders.missing.length) detail.push(`missing ${placeholders.missing.join(', ')}`)
      if (placeholders.extra.length) detail.push(`unexpected ${placeholders.extra.join(', ')}`)
      problems.push(`id "${entry.id}" placeholder mismatch (${detail.join('; ')})`)
    }
    const violations = findProtectedViolations(entry.text, value, protectedTerms)
    if (violations.length) problems.push(`id "${entry.id}" lost protected terms: ${violations.join(', ')}`)
  }
  return problems
}

/** A translation failure that never contains a credential. */
export class TranslationError extends Error {
  constructor(message, details = []) {
    super(redact(message))
    this.name = 'TranslationError'
    this.details = details.map(redact)
  }
}

/**
 * Translate a list of entries.
 *
 * @param {object} request translation request.
 * @param {{id:string,text:string,namespace?:string}[]} request.entries entries to translate.
 * @param {object} [request.config] resolved API config.
 * @param {Record<string,string>} [request.glossary] source-to-target glossary.
 * @param {string[]} [request.protectedTerms] protected terms.
 * @param {Function} [request.fetchImpl] fetch implementation (injectable for tests).
 * @param {number} [request.batchSize] max entries per request.
 * @param {number} [request.maxRetries] retries per batch.
 * @param {'throw'|'copy'} [request.onUnresolved] fall back to the source text when a batch never validates.
 * @param {(info: object) => void} [request.onProgress] progress callback.
 * @returns {Promise<Map<string,string>>} id to translation.
 */
export async function translateEntries(request) {
  const {
    entries,
    sourceLocale = 'en',
    targetLocale,
    config = resolveApiConfig(request),
    glossary = {},
    protectedTerms = DEFAULT_PROTECTED_TERMS,
    fetchImpl = globalThis.fetch,
    batchSize = 40,
    maxChars = 6000,
    maxRetries = 3,
    onUnresolved = 'throw',
    onProgress = () => {},
  } = request

  if (!config?.apiKey) {
    throw new TranslationError(
      'no API key available; set DEEPSEEK_API_KEY (or DSH_LOCALE_API_KEY) or pass --no-translate',
    )
  }
  if (typeof fetchImpl !== 'function') throw new TranslationError('no fetch implementation available')
  if (!targetLocale) throw new TranslationError('target locale is required')

  const batches = batchEntries(entries, { batchSize, maxChars })
  const result = new Map()
  let done = 0

  for (const [batchIndex, batch] of batches.entries()) {
    const prompt = buildPrompt({ sourceLocale, targetLocale, glossary, protectedTerms })
    let problems = []
    let accepted

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const payload = {
        id: batch.map((entry, index) => ({ id: String(index), text: entry.text, key: entry.key })),
      }
      const userContent =
        attempt === 0
          ? JSON.stringify(payload)
          : JSON.stringify({ ...payload, previous_validation_problems: problems })

      const response = await callApi({
        config,
        fetchImpl,
        system: prompt,
        user: userContent,
      })
      let translations
      try {
        const parsed = parseModelJson(response)
        translations = parsed.translations ?? parsed
      } catch (error) {
        problems = [`invalid JSON: ${error.message}`]
        continue
      }

      const normalized = {}
      for (const [id, value] of Object.entries(translations)) normalized[id] = String(value)
      problems = validateBatch(
        batch.map((entry, index) => ({ ...entry, id: String(index) })),
        normalized,
        { glossary, protectedTerms },
      )
      if (problems.length === 0) {
        for (const [index, entry] of batch.entries()) result.set(entry.id, normalized[String(index)])
        accepted = true
        break
      }
    }

    if (!accepted) {
      if (onUnresolved === 'throw') {
        throw new TranslationError(
          `translation batch ${batchIndex + 1}/${batches.length} failed validation after ${maxRetries + 1} attempts`,
          problems,
        )
      }
      for (const entry of batch) result.set(entry.id, entry.text)
      onProgress({ batch: batchIndex + 1, total: batches.length, fallback: batch.length, problems })
    }

    done += batch.length
    onProgress({ batch: batchIndex + 1, total: batches.length, done, keys: entries.length, fallback: accepted ? 0 : batch.length, problems })
  }

  return result
}

/** Perform one chat-completions call and return the assistant text. */
async function callApi({ config, fetchImpl, system, user }) {
  let response
  try {
    response = await fetchImpl(config.apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
  } catch (error) {
    throw new TranslationError(`request to ${redact(config.apiUrl)} failed: ${error.message}`)
  }
  if (!response.ok) {
    const body = await safeText(response)
    throw new TranslationError(`API responded ${response.status}: ${redact(body).slice(0, 300)}`)
  }
  const json = await response.json()
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new TranslationError('API response carried no message content')
  return content
}

/** Read a response body without throwing. */
async function safeText(response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

/** Load a glossary JSON file, merging a default protected list. */
export function loadGlossary(value) {
  const glossary = {}
  const protectedTerms = new Set(DEFAULT_PROTECTED_TERMS)
  if (!value) return { glossary, protectedTerms: [...protectedTerms] }
  const raw = typeof value === 'string' ? JSON.parse(value) : value
  if (Array.isArray(raw)) {
    for (const term of raw) protectedTerms.add(String(term))
    return { glossary, protectedTerms: [...protectedTerms] }
  }
  for (const section of [raw.glossary, raw.terms]) {
    for (const [key, translated] of Object.entries(section ?? {})) glossary[key] = translated
  }
  for (const term of raw.protected ?? []) protectedTerms.add(term)
  return { glossary, protectedTerms: [...protectedTerms] }
}
