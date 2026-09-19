# dsh-locale

**Original author: [Master-Cas](https://github.com/Master-Cas)**
Original repository: https://github.com/Master-Cas/DeepSeek_Harness_Tools — universal language packs for DeepSeek Harness

`dsh-locale` is a zero-dependency Node CLI that discovers every English locale
namespace registered by a DeepSeek Harness checkout, extracts keys, values and
`{placeholder}` signatures, and generates an installable Harness language pack.
It can translate through any OpenAI-compatible chat-completions API, keep an
existing pack up to date, and validate a translation against its source.

The namespace list is **discovered, never hardcoded**: the scanner walks the
Harness source, finds each `ctx.locale.register(...)` call, resolves the
namespace expression and the English dictionary (including imported modules,
inline objects and `register(ns, locale, dict)` tuples), and reads the exact
dictionary values.

```
tools/
  dsh-locale/
    index.mjs        CLI entry point
  lib/
    harness-scan.mjs dynamic namespace/dictionary discovery
    catalog.mjs      canonical catalog format + client.js import
    placeholders.mjs {placeholder} extraction and preservation
    translate.mjs    OpenAI-compatible batching, glossary, retry
    generate.mjs     plugin scaffolding/rendering
    update.mjs       translation-memory diff and update
    validate.mjs     source/target PASS/FAIL validation
    util.mjs         args, JSON I/O, coverage, redaction
```

## Requirements

- Node.js >= 22.6 (24+ recommended). Source `locales.ts` modules are imported
  with type stripping; the compiled `lib/types/**` ESM is used as a fallback.

## Quick start

```bash
# Discover the current English catalog (prints JSON, optional --out).
npm run locale:scan

# Generate a Spanish pack from the canonical catalogs (no API calls).
node tools/dsh-locale/index.mjs generate es \
  --label "Español" \
  --harness /home/ubuntu/deepseek-harness \
  --out plugins/deepseek-es \
  --no-translate

# Validate an existing pack.
npm run locale:validate
```

The CLI is also exposed as `dsh-locale` when the repository is linked
(`npm link`).

## Commands

### `scan`

Discovers namespaces, keys, values and placeholders.

```bash
node tools/dsh-locale/index.mjs scan --harness /path/to/deepseek-harness --json
node tools/dsh-locale/index.mjs scan --out locales/source-en.json --summary
```

On the reference checkout this discovers **48 namespaces / 1643 keys / 322
placeholders** with zero warnings. Output fields:

```json
{
  "version": 1,
  "harness": "deepseek-harness",
  "namespaces": { "common": { "cancel": "Cancel" } },
  "sources": { "common": "packages/client/locale/src/client/index.ts" },
  "stats": { "namespaces": 48, "keys": 1643, "placeholders": 322, "catalogHash": "..." },
  "warnings": []
}
```

### `generate`

Builds an installable bundle (`package.json`, `index.js`, `client.js`,
`cordis.patch.yml`) and the canonical `locales/<locale>.json` catalog.

```bash
node tools/dsh-locale/index.mjs generate es \
  --label "Español" \
  --harness /home/ubuntu/deepseek-harness \
  --out plugins/deepseek-es \
  --catalog-out locales/es.json

# Scaffold by copying English instead of calling an API.
node tools/dsh-locale/index.mjs generate de --label "Deutsch" \
  --harness /home/ubuntu/deepseek-harness --out plugins/deepseek-de --no-translate

# Show the plan without any API call or write.
node tools/dsh-locale/index.mjs generate fr --label "Français" \
  --harness /home/ubuntu/deepseek-harness --out plugins/deepseek-fr --dry-run
```

Existing translations found in `locales/<locale>.json` (or `--catalog FILE`)
are reused; only missing or placeholder-broken keys are sent to the API.

### `update`

Compares an existing catalog with the live scan, translates **only new keys**,
keeps every existing translation, reports obsolete keys and refreshes
coverage. Obsolete keys are kept by default; `--prune` removes them.

```bash
npm run locale:update
node tools/dsh-locale/index.mjs update es \
  --harness /home/ubuntu/deepseek-harness \
  --out plugins/deepseek-es \
  --catalog-out locales/es.json \
  --prune
```

### `validate`

```bash
node tools/dsh-locale/index.mjs validate \
  --source locales/source-en.json \
  --target locales/es.json
```

Checks namespaces, keys, placeholders and empty values. Missing
namespaces/keys, placeholder mismatches and empty translations **FAIL**
(exit code `1`); extra keys/namespaces and values identical to English are
warnings unless `--strict`. Add `--check-protected` to report protected
technical terms lost in translation.

```
Validation: PASS
  namespaces 48/48 · keys 1643/1643 · coverage 100.0%
```

### `import`

Converts an existing Harness language pack `client.js` into a canonical
catalog. The hand-maintained Spanish pack imports all 1643 translations:

```bash
node tools/dsh-locale/index.mjs import plugins/deepseek-spanish/client.js \
  --locale es --label "Español" --out locales/es.json
```

## Automatic translation

`generate`/`update` call any OpenAI-compatible `chat/completions` endpoint.
Requests are JSON batches; a batch is accepted only when the returned keyset
matches the request and every `{placeholder}` survives. Otherwise the batch is
retried with the validation problems attached (default 3 retries).

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | — | default credential |
| `DSH_LOCALE_API_KEY` | — | explicit credential override |
| `DSH_LOCALE_API_URL` | `https://api.deepseek.com/v1/chat/completions` | endpoint |
| `DSH_LOCALE_MODEL` | `deepseek-chat` | model id |
| `DSH_HARNESS` | auto-detect | default `--harness` |

CLI flags: `--api-url`, `--model`, `--batch-size`, `--max-retries`,
`--glossary FILE`, `--lenient` (copy English for a batch that never
validates).

API keys are **never written to disk and never printed**; diagnostics redact
both environment values and anything matching `sk-…`.

### Glossary and protected terms

`--glossary FILE` accepts:

```json
{
  "glossary": { "Deploy": "Desplegar" },
  "terms": { "Run": "Ejecutar" },
  "protected": ["Kubernetes", "OAuth"]
}
```

Glossary entries are injected into the prompt; protected terms must survive
verbatim (a check that is always enforced during batch validation, and that
`validate --check-protected` can re-audit on an existing catalog).

## Catalogs

- `locales/source-en.json` — canonical English catalog produced by `scan`.
- `locales/<locale>.json` — canonical translation catalog produced by
  `generate`/`update`/`import`.

```json
{
  "version": 1,
  "locale": "es",
  "label": "Español",
  "fallback": "en",
  "source": "locales/source-en.json",
  "namespaces": { "common": { "cancel": "Cancelar" } }
}
```

Both files are written with sorted namespaces/keys for stable diffs.

## Generated bundle

```text
plugins/deepseek-<locale>/
  package.json       name, dsh.bundle.patch, dsh.client.platform=web
  index.js           host companion (no-op)
  client.js          window.__ModuleLoader__ plugin: addLanguage + register
  cordis.patch.yml   insert entry wiring the bundle into a profile
```

The generated `client.js` mirrors the public Harness locale API:

```js
ctx.effect(() => ctx.locale.addLanguage({ id: 'es', label: 'Español', fallback: 'en' }))
for (const [namespace, dictionary] of Object.entries(dictionaries)) {
  ctx.effect(() => ctx.locale.register(namespace, 'es', dictionary))
}
```

## Tests

```bash
npm test              # all locale suites + the original smoke test
```

- `tests/locale-scanner.test.mjs` — synthetic fixture (four registration
  shapes) plus the reference-checkout acceptance numbers (48/1643/322).
- `tests/locale-placeholders.test.mjs` — placeholder extraction/comparison.
- `tests/locale-catalog.test.mjs` — Spanish-pack import (1643 keys) and
  credential redaction.
- `tests/locale-translate.test.mjs` — batching, keyset/placeholder retry,
  lenient fallback, redaction.
- `tests/locale-generate-update.test.mjs` — scaffolding, translation memory,
  update/prune.
- `tests/locale-validate.test.mjs` — PASS/FAIL matrix.
- `tests/locale-cli.test.mjs` — end-to-end CLI exit codes.

## License of generated packs

Language packs generated by `dsh-locale` include the **Master-Cas Personal Use License v1.0** by default. Personal non-commercial use is permitted; modification, redistribution and commercial use require prior written authorization from Master-Cas. Generated package manifests use `SEE LICENSE IN LICENSE`, and each generated plugin receives its own `LICENSE` file.
