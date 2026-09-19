# DeepSeek Harness Tools

> **Created and maintained by [Master-Cas](https://github.com/Master-Cas).**
>
> Original community project: **Abyss Theme · Spanish Language Pack · dsh-locale multilingual framework**.
> DeepSeek Harness remains an upstream project by DeepSeek.


Community tools for customizing [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) without maintaining a fork.

This repository currently provides two independent installable bundles plus a
universal pack generator:

- **Abyss Theme** — a deep-ocean dark theme with fluorescent royal-blue / cyan accents.
- **Spanish Language Pack** — adds `Español` to the Harness locale selector and translates every locale namespace registered by the Harness client packages, with English fallback for any future key.
- **`dsh-locale`** — a zero-dependency CLI that discovers Harness locale namespaces dynamically and generates/updates/validates language packs for any locale.

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

### Universal language pack generator (`dsh-locale`)

`tools/dsh-locale` discovers every English locale namespace registered by a
Harness checkout **dynamically** (no hardcoded list) and can `scan`,
`generate`, `update`, `validate` and `import` language packs. It extracts keys,
values and `{placeholder}` signatures, translates through any
OpenAI-compatible API in validated JSON batches, and supports a glossary and
protected technical terms without ever storing or printing an API key. See
[`tools/dsh-locale/README.md`](tools/dsh-locale/README.md) for the full guide.

```bash
npm run locale:scan          # discover the English catalog -> locales/source-en.json
npm run locale:validate      # validate locales/es.json against the source
npm test                     # locale unit tests + the original smoke test
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

MIT. See [LICENSE](LICENSE).
