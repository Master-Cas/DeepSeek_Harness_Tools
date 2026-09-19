#!/usr/bin/env node
/**
 * dsh-locale — universal language-pack generator for DeepSeek Harness.
 *
 * Commands: scan · generate · update · validate · import
 * Zero external dependencies. See tools/dsh-locale/README.md.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  catalogFromPlugin,
  catalogFromScan,
  catalogPath,
  loadCatalog,
  normalizeCatalog,
  writeCatalog,
} from '../lib/catalog.mjs'
import { generateLanguagePack } from '../lib/generate.mjs'
import { scanHarness } from '../lib/harness-scan.mjs'
import { countNamespacePlaceholders } from '../lib/placeholders.mjs'
import {
  loadGlossary,
  resolveApiConfig,
  translateEntries,
} from '../lib/translate.mjs'
import { updateLanguagePack } from '../lib/update.mjs'
import {
  parseArgs,
  percent,
  readJson,
  redact,
  resolveHarness,
  serializeJson,
} from '../lib/util.mjs'
import { formatValidationReport, validateCatalogs } from '../lib/validate.mjs'

const ROOT = process.cwd()
const HELP = `dsh-locale — universal language packs for DeepSeek Harness

Usage:
  dsh-locale scan      [--harness PATH] [--out FILE] [--summary]
  dsh-locale generate  <locale> --label LABEL --out DIR [options]
  dsh-locale update    <locale> [--out DIR] [options]
  dsh-locale validate  --target FILE [--source FILE | --harness PATH] [options]
  dsh-locale import    <client.js> [--locale es] [--out FILE]

Common options:
  --harness PATH     DeepSeek Harness source checkout or lightweight ~/.dsh
                     installation (env DSH_HARNESS, default auto-detect)
  --source FILE      canonical source catalog (default: live scan)
  --json             machine-readable output
  --help, -h         this help

generate/update options:
  --catalog FILE     existing target catalog (translation memory)
  --catalog-out FILE canonical catalog output (default locales/<locale>.json)
  --no-translate     copy English instead of calling the API
  --dry-run          plan only; no API calls and no writes
  --glossary FILE    glossary/protected-terms JSON
  --api-url URL      OpenAI-compatible endpoint (env DSH_LOCALE_API_URL)
  --model ID         model id (env DSH_LOCALE_MODEL)
  --batch-size N     keys per API request (default 40)
  --max-retries N    validation retries per batch (default 3)
  --lenient          copy English for batches that never validate
  --prune            remove obsolete keys on update (default: report only)

validate options:
  --target FILE      target catalog (required)
  --strict            extra keys/namespaces and untranslated values fail
  --check-protected   report protected technical terms lost in translation
`

const COMMON = {
  values: ['harness', 'source', 'out', 'target', 'catalog', 'catalog-out', 'glossary', 'api-url', 'model', 'locale', 'label', 'name', 'id', 'version', 'description', 'fallback', 'batch-size', 'max-retries'],
  booleans: ['json', 'summary', 'help', 'dry-run', 'prune', 'lenient', 'strict', 'check-protected', 'no-translate', 'save-catalog', 'quiet'],
  aliases: { h: 'help' },
}

/** Write text to stderr unless quiet. */
function log(options, message) {
  if (!options.quiet) process.stderr.write(`${message}\n`)
}

/** Print a value as pretty JSON to stdout. */
function printJson(value) {
  process.stdout.write(serializeJson(value))
}

/** Read the canonical repo catalog for a locale when present. */
function existingCatalog(options, locale) {
  const file = options.catalog ?? catalogPath(ROOT, locale)
  return fs.existsSync(file) ? loadCatalog(file) : undefined
}

/** Build the translation runner used by generate/update. */
function makeTranslateRunner(options, locale, sourceLocale = 'en') {
  const config = resolveApiConfig({ apiUrl: options['api-url'], model: options.model })
  const loaded = loadGlossary(options.glossary ? readJson(options.glossary) : undefined)
  const batchSize = Number(options['batch-size'] ?? 40)
  const maxRetries = Number(options['max-retries'] ?? 3)
  return (entries) =>
    translateEntries({
      entries,
      sourceLocale,
      targetLocale: locale,
      config,
      glossary: loaded.glossary,
      protectedTerms: loaded.protectedTerms,
      batchSize,
      maxRetries,
      onUnresolved: options.lenient ? 'copy' : 'throw',
      onProgress: (progress) => {
        const fallback = progress.fallback ? ` (${progress.fallback} copied from English)` : ''
        log(options, `  translated ${progress.done ?? progress.batch}/${progress.keys ?? entries.length} keys${fallback}`)
      },
    })
}

/** Resolve source catalog from `--source` or a live scan. */
async function resolveSource(options) {
  if (options.source) return loadCatalog(options.source)
  const harness = resolveHarness(options.harness)
  const scan = await scanHarness(harness)
  log(options, `Scanned ${harness}: ${scan.stats.namespaces} namespaces, ${scan.stats.keys} keys`)
  return catalogFromScan(scan)
}

/** `scan` — discover namespaces and the English catalog. */
async function runScan(argv) {
  const { options } = parseArgs(argv, COMMON)
  if (options.help) {
    process.stdout.write(HELP)
    return 0
  }
  const harness = resolveHarness(options.harness)
  const scan = await scanHarness(harness)
  if (options.out) {
    writeCatalog(options.out, catalogFromScan(scan))
    log(options, `Wrote ${options.out}`)
  }
  if (options.summary) {
    log(
      options,
      `namespaces: ${scan.stats.namespaces}\nkeys: ${scan.stats.keys}\nplaceholders: ${scan.stats.placeholders}`,
    )
    if (!options.json) return 0
  }
  if (options.json || !options.out) printJson(scan)
  for (const warning of scan.warnings) log(options, `WARNING ${warning}`)
  return 0
}

/** `generate` — build a new installable language pack. */
async function runGenerate(argv) {
  const { _: positionals, options } = parseArgs(argv, COMMON)
  if (options.help) {
    process.stdout.write(HELP)
    return 0
  }
  const locale = positionals[0]
  if (!locale) throw new Error('generate requires a <locale> argument')
  if (!options.label) throw new Error('generate requires --label')
  if (!options.out && !options['dry-run']) throw new Error('generate requires --out DIR')

  const source = await resolveSource(options)
  const existing = existingCatalog(options, locale)
  const name = options.name ?? `@master-cas/deepseek-${locale}`
  const plugin = {
    name,
    id: options.id ?? name,
    version: options.version ?? '0.1.0',
    description: options.description ?? `${options.label} language pack for DeepSeek Harness`,
    dir: options.out ? path.resolve(options.out) : undefined,
  }
  const catalogFile = options['save-catalog'] === false ? undefined : options['catalog-out'] ?? catalogPath(ROOT, locale)

  const result = await generateLanguagePack({
    source,
    existing,
    locale,
    label: options.label,
    fallback: options.fallback ?? 'en',
    noTranslate: Boolean(options['no-translate']),
    dryRun: Boolean(options['dry-run']),
    translate: makeTranslateRunner(options, locale),
    plugin,
    catalogFile,
    sourceRef: options.source ? path.relative(ROOT, options.source) : 'locales/source-en.json',
  })

  if (options.json) printJson({ ...result, source: undefined })
  else if (result.dryRun) {
    log(options, `Dry run: ${result.pending} new key(s), ${result.reused} reused from translation memory`)
  } else {
    log(options, `Generated ${plugin.dir} (${result.translated} translated, ${result.reused} reused)`)
    if (catalogFile) log(options, `Catalog: ${catalogFile}`)
    for (const warning of result.warnings) log(options, `WARNING ${warning}`)
  }
  return 0
}

/** `update` — refresh an existing pack against the current scan. */
async function runUpdate(argv) {
  const { _: positionals, options } = parseArgs(argv, COMMON)
  if (options.help) {
    process.stdout.write(HELP)
    return 0
  }
  const locale = positionals[0]
  if (!locale) throw new Error('update requires a <locale> argument')

  const source = await resolveSource(options)
  const existing = existingCatalog(options, locale)
  if (!existing) throw new Error(`no existing catalog for "${locale}"; run generate first`)
  const label = options.label ?? existing.label ?? locale
  const catalogFile = options['save-catalog'] === false ? undefined : options['catalog-out'] ?? catalogPath(ROOT, locale)

  let plugin
  if (options.out) {
    const name = options.name ?? `@master-cas/deepseek-${locale}`
    plugin = {
      dir: path.resolve(options.out),
      name,
      id: options.id ?? name,
      version: options.version ?? '0.1.0',
      description: options.description ?? `${label} language pack for DeepSeek Harness`,
    }
  }

  const result = await updateLanguagePack({
    source,
    existing,
    locale,
    label,
    fallback: options.fallback ?? existing.fallback ?? 'en',
    noTranslate: Boolean(options['no-translate']),
    dryRun: Boolean(options['dry-run']),
    prune: Boolean(options.prune),
    translate: makeTranslateRunner(options, locale),
    catalogFile,
    plugin,
    sourceRef: options.source ? path.relative(ROOT, options.source) : 'locales/source-en.json',
  })

  if (options.json) printJson({ ...result, catalog: undefined, obsolete: result.obsolete?.slice(0, 200) })
  else {
    log(options, `Update ${locale}: +${result.added} new, ${result.reused} reused, ${result.removed} obsolete`)
    log(options, `Coverage: ${percent(result.coverage?.ratio ?? 1)}`)
    if (result.wrote) log(options, `Wrote ${catalogFile ?? ''}${result.pluginDir ? ` and ${result.pluginDir}` : ''}`)
    for (const warning of result.warnings.slice(0, 50)) log(options, `WARNING ${warning}`)
  }
  return 0
}

/** `validate` — compare source and target catalogs. */
async function runValidate(argv) {
  const { _: positionals, options } = parseArgs(argv, COMMON)
  if (options.help) {
    process.stdout.write(HELP)
    return 0
  }
  const targetFile = options.target ?? positionals[0]
  if (!targetFile) throw new Error('validate requires --target FILE (or a positional target)')
  const source = await resolveSource(options)
  const target = loadCatalog(targetFile)
  const report = validateCatalogs(source, target, {
    strict: Boolean(options.strict),
    checkProtected: Boolean(options['check-protected']),
  })

  if (options.json) printJson(report)
  else {
    const text = formatValidationReport(report)
    process.stdout.write(`${text}\n`)
  }
  return report.pass ? 0 : 1
}

/** `import` — convert an existing language-pack client.js into a catalog. */
async function runImport(argv) {
  const { _: positionals, options } = parseArgs(argv, COMMON)
  if (options.help) {
    process.stdout.write(HELP)
    return 0
  }
  const file = positionals[0]
  if (!file) throw new Error('import requires a client.js path')
  const plugin = catalogFromPlugin(path.resolve(file))
  const locale = options.locale ?? plugin.locale
  if (!locale) throw new Error('cannot infer locale; pass --locale')
  const catalog = normalizeCatalog({
    version: 1,
    locale,
    label: options.label ?? plugin.label ?? locale,
    fallback: plugin.fallback ?? 'en',
    source: 'locales/source-en.json',
    namespaces: plugin.namespaces,
  })

  let total = 0
  for (const dictionary of Object.values(catalog.namespaces)) total += Object.keys(dictionary).length

  if (options.out) writeCatalog(options.out, catalog)
  if (options.json) printJson({ id: plugin.id, locale, namespaces: Object.keys(catalog.namespaces).length, keys: total, placeholders: countNamespacePlaceholders(catalog.namespaces), out: options.out ?? null })
  else {
    log(options, `Imported ${plugin.id}: ${Object.keys(catalog.namespaces).length} namespaces, ${total} keys`)
    if (options.out) log(options, `Wrote ${options.out}`)
  }
  return 0
}

const COMMANDS = {
  scan: runScan,
  generate: runGenerate,
  update: runUpdate,
  validate: runValidate,
  import: runImport,
}

/**
 * CLI entry point.
 * @param {string[]} argv arguments without the node/bin prefix.
 * @returns {Promise<number>} process exit code.
 */
export async function main(argv = process.argv.slice(2)) {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP)
    return command ? 0 : 1
  }
  if (!COMMANDS[command]) {
    process.stderr.write(`Unknown command "${command}"\n\n${HELP}`)
    return 2
  }
  try {
    return await COMMANDS[command](argv.slice(1))
  } catch (error) {
    process.stderr.write(`Error: ${redact(error.message)}\n`)
    if (process.env.DSH_LOCALE_DEBUG) process.stderr.write(`${redact(error.stack)}\n`)
    return 1
  }
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invoked) {
  main().then((code) => {
    process.exitCode = code
  })
}

export { HELP }
