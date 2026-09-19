/**
 * Shared helpers for the dsh-locale CLI: argument parsing, JSON I/O, hashing,
 * coverage maths and credential redaction. No external dependencies.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Locales that a generated pack can target, all BCP 47-style tags. */
export const LOCALE_ID_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

/**
 * Parse a `--flag`/`--key value`/`--key=value` command line.
 *
 * @param {string[]} argv arguments after the subcommand name.
 * @param {object} [spec] option declaration.
 * @param {string[]} [spec.booleans] flags that take no value.
 * @param {string[]} [spec.arrays] repeatable options.
 * @param {Record<string, string>} [spec.aliases] short-to-long mapping.
 * @param {string[]} [spec.values] options that take a value.
 * @returns {{ _: string[], options: Record<string, unknown> }}
 */
export function parseArgs(argv, spec = {}) {
  const booleans = new Set(spec.booleans ?? [])
  const arrays = new Set(spec.arrays ?? [])
  const values = new Set(spec.values ?? [])
  const aliases = spec.aliases ?? {}
  const options = {}
  const positionals = []

  for (let i = 0; i < argv.length; i++) {
    let token = argv[i]
    if (token === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (!token.startsWith('-') || token === '-') {
      positionals.push(token)
      continue
    }

    let name
    let inline
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      name = eq === -1 ? token.slice(2) : token.slice(2, eq)
      inline = eq === -1 ? undefined : token.slice(eq + 1)
    } else {
      const eq = token.indexOf('=')
      const short = eq === -1 ? token.slice(1) : token.slice(1, eq)
      name = aliases[short] ?? short
      inline = eq === -1 ? undefined : token.slice(eq + 1)
    }

    if (name.startsWith('no-') && booleans.has(name.slice(3))) {
      options[name.slice(3)] = false
      continue
    }
    if (booleans.has(name)) {
      options[name] = true
      continue
    }
    if (inline === undefined) {
      if (i + 1 >= argv.length || (argv[i + 1].startsWith('--') && values.has(name))) {
        throw new Error(`option --${name} requires a value`)
      }
      inline = argv[++i]
    }
    if (arrays.has(name)) {
      if (!Array.isArray(options[name])) options[name] = []
      options[name].push(inline)
    } else if (values.has(name) || !booleans.has(name)) {
      options[name] = inline
    }
  }

  return { _: positionals, options }
}

/** Read a JSON file, returning undefined when the path is absent. */
export function readJsonOptional(file) {
  if (!file || !fs.existsSync(file)) return undefined
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Read a required JSON file with a friendly error. */
export function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`JSON file not found: ${file}`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Serialize with two-space indentation and a trailing newline. */
export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** Write a file, creating parent directories. */
export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

/** Write JSON with a trailing newline. */
export function writeJson(file, value) {
  writeText(file, serializeJson(value))
}

/** Stable, order-sensitive hash used in coverage manifests. */
export function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

/** Sorted copy of an object's keys. */
export function sortedKeys(value) {
  return Object.keys(value ?? {}).sort()
}

/** Stable key-sorted clone of a flat dictionary. */
export function sortDictionary(dictionary) {
  const out = {}
  for (const key of sortedKeys(dictionary)) out[key] = dictionary[key]
  return out
}

/**
 * Redact API keys from any value before printing or writing. DSH never stores
 * credentials, and diagnostics must never leak them either.
 *
 * @param {unknown} value value to sanitize.
 * @returns {string} sanitized text.
 */
export function redact(value) {
  let text = typeof value === 'string' ? value : String(value)
  const secrets = [process.env.DEEPSEEK_API_KEY, process.env.DSH_LOCALE_API_KEY]
    .filter((secret) => typeof secret === 'string' && secret.length >= 6)
  for (const secret of secrets) text = text.split(secret).join('[REDACTED]')
  return text.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
}

/** Compute per-namespace and overall translation coverage. */
export function computeCoverage(source, target) {
  const namespaces = []
  let sourceKeys = 0
  let translated = 0
  for (const namespace of sortedKeys(source)) {
    const sourceDict = source[namespace] ?? {}
    const targetDict = target?.[namespace] ?? {}
    const keys = sortedKeys(sourceDict)
    const done = keys.filter((key) => typeof targetDict[key] === 'string' && targetDict[key] !== '')
    sourceKeys += keys.length
    translated += done.length
    namespaces.push({
      namespace,
      sourceKeys: keys.length,
      translated: done.length,
      missing: keys.length - done.length,
      ratio: keys.length === 0 ? 1 : done.length / keys.length,
    })
  }
  return {
    namespaces,
    sourceKeys,
    translated,
    missing: sourceKeys - translated,
    ratio: sourceKeys === 0 ? 1 : translated / sourceKeys,
  }
}

/** Percentage with one decimal place. */
export function percent(ratio) {
  return `${(ratio * 100).toFixed(1)}%`
}

/** Resolve a harness checkout from an explicit value, env or common locations. */
export function resolveHarness(explicit) {
  const candidates = []
  if (explicit) candidates.push(explicit)
  if (process.env.DSH_HARNESS) candidates.push(process.env.DSH_HARNESS)
  candidates.push(path.join(process.cwd(), '..', 'deepseek-harness'))
  candidates.push(path.join(os.homedir(), 'deepseek-harness'))
  candidates.push('/home/ubuntu/deepseek-harness')
  for (const candidate of candidates) {
    if (!candidate) continue
    const resolved = path.resolve(candidate)
    if (fs.existsSync(path.join(resolved, 'package.json'))) return resolved
  }
  throw new Error(
    'cannot locate a DeepSeek Harness checkout; pass --harness <path> or set DSH_HARNESS',
  )
}

/** Human-readable timestamp for catalogs. */
export function nowIso() {
  return new Date().toISOString()
}
