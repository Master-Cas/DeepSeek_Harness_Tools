/**
 * Stored-credential resolution tests.
 *
 * They prove, against a *fictitious* lightweight-install fixture:
 *
 *   - priority options.apiKey > DSH_LOCALE_API_KEY > DEEPSEEK_API_KEY >
 *     the DEEPSEEK_API_KEY Harness stored in `$DSH_HOME/.credentials.yaml`;
 *   - the YAML is read only through the located
 *     `@deepseek-ai/dsh-credentials-local` `parseCredentialsDocument` export;
 *   - a missing store/parser preserves the ordinary "no API key" error;
 *   - the sentinel secret never appears in errors, CLI stdout or CLI stderr;
 *   - `makeTranslateRunner` resolves the config lazily, so a dry run never
 *     reads the store.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTranslateRunner } from '../tools/dsh-locale/index.mjs'
import {
  resolveApiConfigAsync,
  resolveStoredHarnessCredential,
  translateEntries,
} from '../tools/lib/translate.mjs'
import { redact, serializeJson } from '../tools/lib/util.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(root, 'tools', 'dsh-locale', 'index.mjs')
const sourceFixture = path.join(root, 'tests', 'fixtures', 'harness')
const credsFixture = path.join(root, 'tests', 'fixtures', 'lightweight-credentials')
const parserFixture = path.join(
  credsFixture,
  'node_modules',
  '@deepseek-ai',
  'dsh-credentials-local',
  'lib',
  'index.js',
)
const storeFixture = path.join(credsFixture, '.credentials.yaml')

const SENTINEL_STORE = 'sentinel-store-key-0123456789'
const SENTINEL_LOCALE = 'sentinel-locale-key-0123456789'
const SENTINEL_DEEPSEEK = 'sentinel-deepseek-key-0123456789'
const SENTINEL_OPTION = 'sentinel-option-key-0123456789'

const tmp = fs.mkdtempSync(path.join(root, '.tmp-locale-credentials-'))
const missingRoot = path.join(tmp, 'missing-credentials')

const ENV_KEYS = [
  'DEEPSEEK_API_KEY',
  'DSH_LOCALE_API_KEY',
  'DSH_HOME',
  'DSH_HARNESS',
  'DSH_LOCALE_API_URL',
  'DSH_LOCALE_FIXTURE_PARSER_MARKER',
]

/** Snapshot the environment variables this suite mutates. */
function saveEnv() {
  const saved = {}
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  return saved
}

/** Restore a snapshot from {@link saveEnv}. */
function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
}

/** Clear every credential-related variable so a section starts hermetic. */
function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key]
}

/** Run the CLI with credential variables scrubbed, then the given overrides. */
function runCli(args, extraEnv = {}) {
  const env = { ...process.env }
  for (const key of ENV_KEYS) delete env[key]
  Object.assign(env, extraEnv)
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
    timeout: 20000,
  })
}

const entries = [{ id: 'ns\u0000a', namespace: 'ns', key: 'a', text: 'Hello {name}' }]

const saved = saveEnv()
try {
  // The fixture parser is the real file the resolver must locate.
  assert.ok(fs.statSync(parserFixture).isFile(), 'fixture parser must exist')
  assert.ok(fs.statSync(storeFixture).isFile(), 'fixture store must exist')

  // --- Store resolution through the located parser ------------------------
  clearEnv()
  {
    const credential = await resolveStoredHarnessCredential({
      harness: credsFixture,
      dshHome: credsFixture,
    })
    assert.equal(credential, SENTINEL_STORE, 'stored DEEPSEEK_API_KEY must be returned')
  }

  // --- Priority ------------------------------------------------------------
  clearEnv()
  {
    process.env.DSH_LOCALE_API_KEY = SENTINEL_LOCALE
    process.env.DEEPSEEK_API_KEY = SENTINEL_DEEPSEEK

    const explicit = await resolveApiConfigAsync({
      apiKey: SENTINEL_OPTION,
      harness: credsFixture,
      dshHome: credsFixture,
    })
    assert.equal(explicit.apiKey, SENTINEL_OPTION, 'options.apiKey wins')

    const locale = await resolveApiConfigAsync({ harness: credsFixture, dshHome: credsFixture })
    assert.equal(locale.apiKey, SENTINEL_LOCALE, 'DSH_LOCALE_API_KEY wins over DEEPSEEK_API_KEY and the store')

    delete process.env.DSH_LOCALE_API_KEY
    const deepseek = await resolveApiConfigAsync({ harness: credsFixture, dshHome: credsFixture })
    assert.equal(deepseek.apiKey, SENTINEL_DEEPSEEK, 'DEEPSEEK_API_KEY wins over the store')

    delete process.env.DEEPSEEK_API_KEY
    const stored = await resolveApiConfigAsync({ harness: credsFixture, dshHome: credsFixture })
    assert.equal(stored.apiKey, SENTINEL_STORE, 'the stored credential is the last resort')
  }

  // --- Injectable resolver (priority without touching disk) ----------------
  clearEnv()
  {
    let calls = 0
    const config = await resolveApiConfigAsync(
      {},
      {
        resolveStoredHarnessCredential: async () => {
          calls++
          return SENTINEL_OPTION
        },
      },
    )
    assert.equal(calls, 1)
    assert.equal(config.apiKey, SENTINEL_OPTION, 'injected stored resolver supplies the fallback')
  }

  // --- No store/parser preserves the missing-credential error --------------
  clearEnv()
  {
    const config = await resolveApiConfigAsync({
      harness: sourceFixture,
      credentialsModule: path.join(missingRoot, 'lib', 'index.js'),
      credentialsPath: path.join(missingRoot, '.credentials.yaml'),
    })
    assert.equal(config.apiKey, undefined, 'no parser/store must not fabricate a credential')
    await assert.rejects(
      translateEntries({
        entries,
        targetLocale: 'es',
        config,
        fetchImpl: async () => {
          throw new Error('should not be called')
        },
      }),
      (error) =>
        error instanceof Error &&
        /no API key/.test(error.message) &&
        /DEEPSEEK_API_KEY/.test(error.message),
    )
  }

  // --- The stored sentinel never leaks into errors or serialized output ----
  clearEnv()
  {
    const config = await resolveApiConfigAsync({ harness: credsFixture, dshHome: credsFixture })
    assert.equal(config.apiKey, SENTINEL_STORE)

    await assert.rejects(
      translateEntries({
        entries,
        targetLocale: 'es',
        config,
        fetchImpl: async () => {
          throw new Error(`connection failed for bearer ${SENTINEL_STORE}`)
        },
      }),
      (error) => !error.message.includes(SENTINEL_STORE) && error.message.includes('[REDACTED]'),
    )

    assert.equal(redact(`Authorization: Bearer ${SENTINEL_STORE}`), 'Authorization: Bearer [REDACTED]')
    assert.ok(
      !serializeJson({ apiUrl: config.apiUrl, model: config.model }).includes(SENTINEL_STORE),
      'serialized config fragments must never carry the secret',
    )
  }

  // --- makeTranslateRunner resolves the config only when invoked -----------
  clearEnv()
  {
    const marker = path.join(tmp, 'runner-parser-called')
    process.env.DSH_LOCALE_FIXTURE_PARSER_MARKER = marker
    const runner = makeTranslateRunner({ harness: credsFixture, dshHome: credsFixture, quiet: true }, 'xx')
    assert.equal(typeof runner, 'function')
    assert.ok(!fs.existsSync(marker), 'constructing the runner must not read the store')
    delete process.env.DSH_LOCALE_FIXTURE_PARSER_MARKER
  }

  // --- CLI dry run never resolves the stored credential --------------------
  {
    const marker = path.join(tmp, 'cli-dry-run-parser-called')
    const outcome = runCli(['generate', 'xx', '--label', 'Testish', '--harness', sourceFixture, '--dry-run'], {
      DSH_HOME: credsFixture,
      DSH_LOCALE_FIXTURE_PARSER_MARKER: marker,
    })
    assert.equal(outcome.status, 0, outcome.stderr)
    assert.ok(!fs.existsSync(marker), 'CLI dry run must not read the store')
    assert.ok(!outcome.stdout.includes(SENTINEL_STORE))
    assert.ok(!outcome.stderr.includes(SENTINEL_STORE))
  }

  // --- CLI non-dry-run uses the stored key and never prints it -------------
  {
    const marker = path.join(tmp, 'cli-run-parser-called')
    const outDir = path.join(tmp, 'deepseek-xx')
    const outcome = runCli(
      [
        'generate',
        'xx',
        '--label',
        'Testish',
        '--harness',
        sourceFixture,
        '--out',
        outDir,
        '--catalog-out',
        path.join(tmp, 'xx.json'),
        '--api-url',
        'http://127.0.0.1:1/v1/chat/completions',
      ],
      {
        DSH_HOME: credsFixture,
        DSH_LOCALE_FIXTURE_PARSER_MARKER: marker,
      },
    )
    assert.ok(fs.existsSync(marker), 'a real translation run must read the store')
    assert.notEqual(outcome.status, 0, 'the unreachable endpoint must fail the run')
    assert.ok(
      !outcome.stdout.includes(SENTINEL_STORE) && !outcome.stderr.includes(SENTINEL_STORE),
      'the stored sentinel must never appear in CLI output',
    )
  }

  console.log('stored-credential tests: PASS')
} finally {
  restoreEnv(saved)
  fs.rmSync(tmp, { recursive: true, force: true })
}
