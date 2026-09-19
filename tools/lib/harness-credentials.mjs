/**
 * Reuse the credential DeepSeek Harness already stored for `DEEPSEEK_API_KEY`.
 *
 * Harness keeps credentials in `$DSH_HOME/.credentials.yaml`, and the document
 * is *only* understood by its own package — `@deepseek-ai/dsh-credentials-local`
 * — whose public `parseCredentialsDocument(text, filename)` is the supported
 * reader. This module therefore never parses YAML: it locates that package
 * inside a detected lightweight `~/.dsh` installation (or a source checkout),
 * calls the public export, and reads the requested reference's value.
 *
 * The document text and the secret it carries never leave this module. Only a
 * non-empty string value is returned; every failure (no store, no parser,
 * unreadable or invalid document) collapses to `undefined` so callers fall
 * through to their ordinary "no API key" message without ever echoing the
 * store's contents.
 *
 * Import graph: `harness-credentials` -> `harness-detect` -> `installed-scan`
 * -> `util`; `translate` sits above it and adds no cycle.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { detectHarnessMode } from './harness-detect.mjs'

/** Reference whose stored value dsh-locale reuses. */
export const STORED_API_KEY_REF = 'DEEPSEEK_API_KEY'

/** Basename of the Harness credentials document. */
export const CREDENTIALS_FILENAME = '.credentials.yaml'

/** Package-relative path of the public credentials parser. */
const CREDENTIALS_PACKAGE = path.join('dsh-credentials-local', 'lib', 'index.js')

/** Scoped package directory name. */
const CREDENTIALS_SCOPE = '@deepseek-ai'

/**
 * Resolve the Harness home that owns the credential store.
 *
 * @param {string} [explicit] explicit `dshHome` from a caller.
 * @returns {string} absolute Harness home (`$DSH_HOME`, else `~/.dsh`).
 */
export function resolveDshHome(explicit) {
  for (const candidate of [explicit, process.env.DSH_HOME]) {
    if (typeof candidate === 'string' && candidate.trim()) return path.resolve(candidate)
  }
  return path.join(os.homedir(), '.dsh')
}

/**
 * Candidate credentials documents, most specific first. When `credentialsPath`
 * is given it is the only candidate, which keeps callers (and tests) from
 * ever falling back to an unrelated real store.
 *
 * A source checkout has no store of its own, so the DSH home (and therefore
 * `~/.dsh`) is always among the fallbacks.
 *
 * @param {object} [options] resolution options.
 * @param {string} [options.credentialsPath] explicit document path.
 * @param {string} [options.dshHome] explicit Harness home.
 * @param {string} [options.harness] detected harness root (installed or source).
 * @returns {string[]} absolute candidate paths.
 */
export function credentialsStoreCandidates(options = {}) {
  if (typeof options.credentialsPath === 'string' && options.credentialsPath.trim()) {
    return [path.resolve(options.credentialsPath)]
  }
  const homes = []
  const add = (home) => {
    if (typeof home !== 'string' || !home.trim()) return
    const resolved = path.resolve(home)
    if (!homes.includes(resolved)) homes.push(resolved)
  }
  add(options.dshHome)
  add(process.env.DSH_HOME)
  add(path.join(os.homedir(), '.dsh'))
  add(options.harness)
  return homes.map((home) => path.join(home, CREDENTIALS_FILENAME))
}

/**
 * Candidate parser entry points, most specific first. An explicit
 * `credentialsModule` restricts the search to exactly that file.
 *
 * @param {object} [options] resolution options.
 * @param {string} [options.credentialsModule] explicit `lib/index.js` path.
 * @param {string} [options.harness] detected harness root.
 * @param {string} [options.dshHome] explicit Harness home.
 * @returns {string[]} absolute candidate paths.
 */
export function credentialsModuleCandidates(options = {}) {
  const paths = []
  const add = (candidate) => {
    if (typeof candidate === 'string' && candidate && !paths.includes(candidate)) paths.push(candidate)
  }
  if (typeof options.credentialsModule === 'string' && options.credentialsModule.trim()) {
    return [path.resolve(options.credentialsModule)]
  }

  const roots = []
  const addRoot = (root) => {
    if (typeof root !== 'string' || !root.trim()) return
    const resolved = path.resolve(root)
    if (!roots.includes(resolved)) roots.push(resolved)
  }
  addRoot(options.harness)
  addRoot(process.env.DSH_HARNESS)
  addRoot(options.dshHome)
  addRoot(process.env.DSH_HOME)
  addRoot(path.join(os.homedir(), '.dsh'))

  for (const root of roots) {
    // A lightweight installation: every `@deepseek-ai` scope reachable from it.
    const detected = detectHarnessMode(root)
    if (detected?.mode === 'installed') {
      for (const scope of detected.scopeRoots ?? []) add(path.join(scope, CREDENTIALS_PACKAGE))
    }
    // A source checkout: the workspace package plus any installed copy.
    add(path.join(root, 'packages', 'credentials', 'credentials-local', 'lib', 'index.js'))
    add(path.join(root, 'node_modules', CREDENTIALS_SCOPE, CREDENTIALS_PACKAGE))
    add(path.join(root, 'node_modules', '.pnpm', 'node_modules', CREDENTIALS_SCOPE, CREDENTIALS_PACKAGE))
    add(path.join(root, 'profiles', 'node_modules', CREDENTIALS_SCOPE, CREDENTIALS_PACKAGE))
  }
  return paths
}

/**
 * Locate the first existing credentials parser entry point.
 *
 * @param {object} [options] see {@link credentialsModuleCandidates}.
 * @returns {string|undefined} absolute `lib/index.js` path.
 */
export function findCredentialsModule(options = {}) {
  for (const candidate of credentialsModuleCandidates(options)) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // Candidate absent; keep looking.
    }
  }
  return undefined
}

/** Loaded parser modules, keyed by absolute path. */
const moduleCache = new Map()

/** Import a parser module once; a failed import is not cached. */
function loadCredentialsModule(file) {
  if (!moduleCache.has(file)) {
    const promise = import(pathToFileURL(file).href).catch((error) => {
      moduleCache.delete(file)
      throw error
    })
    moduleCache.set(file, promise)
  }
  return moduleCache.get(file)
}

/** Read one reference from either the Map or the plain-object shape. */
function readReference(refs, name) {
  if (refs instanceof Map) return refs.get(name)
  if (refs && typeof refs === 'object') return refs[name]
  return undefined
}

/**
 * Resolve the `DEEPSEEK_API_KEY` value Harness stored for this DSH home.
 *
 * The official parser is located from a detected lightweight installation and
 * invoked with the raw document text; nothing here parses YAML, and no error
 * ever carries the document or the secret. A missing parser, missing store or
 * invalid document resolves to `undefined`.
 *
 * @param {object} [options] resolution options.
 * @param {string} [options.credentialsModule] explicit parser `lib/index.js`.
 * @param {string} [options.credentialsPath] explicit `$DSH_HOME/.credentials.yaml`.
 * @param {string} [options.dshHome] explicit Harness home.
 * @param {string} [options.harness] detected harness root.
 * @param {string} [options.credentialsRef] reference to read (default `DEEPSEEK_API_KEY`).
 * @returns {Promise<string|undefined>} the stored secret, when present.
 */
export async function resolveStoredHarnessCredential(options = {}) {
  const ref =
    typeof options.credentialsRef === 'string' && options.credentialsRef.trim()
      ? options.credentialsRef
      : STORED_API_KEY_REF

  const modulePath = findCredentialsModule(options)
  if (!modulePath) return undefined

  let parse
  try {
    const loaded = await loadCredentialsModule(modulePath)
    parse = loaded?.parseCredentialsDocument
  } catch {
    return undefined
  }
  if (typeof parse !== 'function') return undefined

  for (const file of credentialsStoreCandidates(options)) {
    let text
    try {
      if (!fs.statSync(file).isFile()) continue
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    try {
      const document = parse(text, file)
      const value = readReference(document?.refs, ref)
      if (typeof value === 'string' && value.length > 0) return value
    } catch {
      // Invalid or unsupported document: treat as no stored credential. The
      // parser's message can quote the input, so it is never surfaced.
      continue
    }
  }
  return undefined
}
