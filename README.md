# DeepSeek Harness Tools

> **Created and maintained by [Master-Cas](https://github.com/Master-Cas).**
>
> Original community project: **Abyss Theme · Spanish Language Pack · dsh-locale multilingual framework**.
> DeepSeek Harness remains an upstream project by DeepSeek.
>
> **PERSONAL USE ONLY — NO MODIFICATION, REDISTRIBUTION OR COMMERCIAL USE WITHOUT PRIOR WRITTEN AUTHORIZATION FROM MASTER-CAS.**
> Commercial licensing requires a separate written agreement with Master-Cas.


Community tools for customizing [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) without maintaining a fork.

## Three operational components

| Component | Status | Purpose |
| --- | --- | --- |
| **Abyss Theme / Dark Ocean** | **Operational** | Deep-ocean dark theme with fluorescent royal-blue / cyan accents. |
| **Spanish Language Pack** | **Operational** | Full Spanish UI pack for the current Harness locale surface. |
| **Multilingual Framework — `dsh-locale`** | **Operational** | Automatically discovers Harness locale namespaces and generates, updates, validates and imports language packs for **any language**. |

The multilingual framework is not limited to Spanish. It can be used to build packs such as **Deutsch**, **Français**, **Português**, **Italiano**, **日本語**, **한국어**, and others from the same Harness source catalog.

### Multilingual workflow

```text
DeepSeek Harness
      │
      ▼
dsh-locale scan
      │
      ▼
English source catalog
      │
      ▼
dsh-locale generate <locale>
      │
      ▼
Installable language pack
      │
      ├── update   → translate only new Harness keys
      ├── validate → verify namespaces / keys / placeholders
      └── import   → recover an existing pack into a canonical catalog
```

Example — generate German:

```bash
node tools/dsh-locale/index.mjs generate de   --label "Deutsch"   --harness /path/to/deepseek-harness   --out plugins/deepseek-de
```

The generated pack automatically carries **Master-Cas authorship**, repository metadata, and the **Master-Cas Personal Use License v1.0**.

> This project is not affiliated with or endorsed by DeepSeek. DeepSeek Harness is MIT licensed; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Quick install

Both installers default to the `web` profile. Override it with `DSH_PROFILE=<profile>`.

### Abyss Theme

```bash
curl -fsSL https://raw.githubusercontent.com/Master-Cas/DeepSeek_Harness_Tools/main/installers/install-theme.sh | bash
```

### Spanish

```bash
curl -fsSL https://raw.githubusercontent.com/Master-Cas/DeepSeek_Harness_Tools/main/installers/install-spanish.sh | bash
```

For a source checkout where `dsh` is not globally installed, set `DSH_ROOT`:

```bash
DSH_ROOT=$HOME/deepseek-harness DSH_PROFILE=web \
  bash installers/install-theme.sh
```

The scripts detect either a global `dsh` CLI or a source checkout runnable with `pnpm dsh`.

## Uninstall

```bash
bash installers/install-theme.sh --uninstall
bash installers/install-spanish.sh --uninstall
```

## What the bundles do

### Abyss Theme

The bundle uses the public Harness Client theme API:

```text
ctx.theme.overrideTokens(...)
```

It does not patch the Harness source tree. The palette focuses on:

- deep navy application background;
- petroleum-blue raised surfaces;
- fluorescent royal-blue primary accent;
- bioluminescent cyan secondary accents;
- cool blue-grey text and borders;
- fluorescent treatment for the existing whale mark;
- abyss fills for the light control surfaces the base palette ships white, and
  deep ink on the light/selected controls that keep a light fill, so text and
  icons stay readable without changing dark appearance.

### Spanish Language Pack

The bundle uses the public locale extension APIs:

```text
ctx.locale.addLanguage({ id: 'es', label: 'Español', fallback: 'en' })
ctx.locale.register(namespace, 'es', dictionary)
```

The preference is stored by Harness itself. Browser locales such as `es`, `es-CL`, and `es-ES` can resolve to Spanish through the normal locale registry.

The pack mirrors every locale namespace registered by the Harness client packages (common actions, settings, sidebar, workspaces, model selector, chat/composer, commands, goals, jobs, trajectory, deliverables, document previews, approval, permissions, plugins, and more). The smoke test pins the namespace list, per-namespace key counts, and placeholder signatures so new Harness keys surface as a test failure rather than silently falling back to English.

### Multilingual Framework (`dsh-locale`)

`dsh-locale` is the multilingual framework included in this repository. It discovers every English locale namespace registered by a Harness checkout **dynamically** — there is no hardcoded language-specific namespace list — and can:

- `scan` the current Harness locale surface;
- `generate` a complete pack for a new language;
- `update` an existing language by translating only newly added Harness keys;
- `validate` namespace, key and placeholder parity;
- `import` an existing language pack back into a canonical locale catalog.

It extracts source values and `{placeholder}` signatures, translates through any OpenAI-compatible API in validated JSON batches, supports glossaries and protected technical terms, and never stores or prints an API key.

The framework is language-agnostic: Spanish is the first complete reference implementation, not a limitation of the system.

See [`tools/dsh-locale/README.md`](tools/dsh-locale/README.md) for the full guide.

```bash
npm run locale:scan          # discover the English catalog -> locales/source-en.json
npm run locale:validate      # validate locales/es.json against the source
npm test                     # locale unit tests + the original smoke test
```

Examples for new languages:

```bash
# German
node tools/dsh-locale/index.mjs generate de --label "Deutsch" --harness /path/to/deepseek-harness --out plugins/deepseek-de

# French
node tools/dsh-locale/index.mjs generate fr --label "Français" --harness /path/to/deepseek-harness --out plugins/deepseek-fr

# Brazilian Portuguese
node tools/dsh-locale/index.mjs generate pt-BR --label "Português (Brasil)" --harness /path/to/deepseek-harness --out plugins/deepseek-pt-br
```

The canonical catalogs live in `locales/source-en.json` and
`locales/es.json`; the existing Spanish pack imports into the latter with all
1643 translations preserved.

## npm scripts

| Script | Purpose |
| --- | --- |
| `npm test` | run every locale test suite plus the smoke test |
| `npm run locale` | raw CLI (`node tools/dsh-locale/index.mjs`) |
| `npm run locale:scan` | refresh `locales/source-en.json` from the Harness checkout |
| `npm run locale:validate` | validate `locales/es.json` against the source |
| `npm run locale:update` | translate only new keys into `locales/es.json` |
| `npm run locale:check` | `node --check` the CLI and core modules |

## Requirements

- DeepSeek Harness with the installable bundle/plugin system.
- A writable Harness profile.
- `git` plus either:
  - global `dsh`; or
  - `pnpm` and a DeepSeek Harness source checkout.
- Node.js >= 22.6 (24+ recommended) for the `dsh-locale` generator and tests.

## Repository layout

```text
installers/
  install-theme.sh
  install-spanish.sh
plugins/
  deepseek-abyss-theme/
  deepseek-spanish/
locales/
  source-en.json        canonical English catalog (48 namespaces / 1643 keys)
  es.json               canonical Spanish catalog (1643 translations)
tools/
  dsh-locale/           CLI + documentation
  lib/                  scanner, catalogs, translation, generate, update, validate
tests/
  run.mjs               test runner
  locale-*.test.mjs     scanner/placeholder/catalog/translate/generate/validate/CLI
  fixtures/harness/     synthetic checkout proving generic discovery
  smoke.mjs             original bundle smoke test
```

## Compatibility

Initial development and smoke validation target DeepSeek Harness `0.1.6-alpha.2` and its current Client extension APIs. The installers fail early when the CLI/profile mechanism is unavailable.

## Author

Created and maintained by **Master-Cas**.

GitHub: https://github.com/Master-Cas

If you use, share, fork, or redistribute these tools, please keep the original attribution to **Master-Cas** and the repository link.

## License

**Current releases (v0.3.0 and later): Master-Cas Personal Use License v1.0.**

Permitted without a separate agreement:
- personal, private, non-commercial use of the original unmodified software;
- normal end-user configuration exposed by the software;
- copies reasonably necessary for installation and backup.

Not permitted without prior written authorization from **Master-Cas**:
- modifying or creating derivative versions;
- redistributing, mirroring, repackaging or sublicensing;
- selling, monetizing or incorporating the software into a commercial product or service;
- any other commercial exploitation.

Commercial use requires a separate written agreement and applicable financial terms with Master-Cas.

See [LICENSE](LICENSE) for the controlling terms. Releases through **v0.2.1** were distributed under MIT; the historical text is preserved in [LICENSE-MIT-HISTORICAL](LICENSE-MIT-HISTORICAL). Those prior grants are not retroactively revoked.

This project is **source-available, not open-source**, beginning with v0.3.0. Third-party components remain under their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
