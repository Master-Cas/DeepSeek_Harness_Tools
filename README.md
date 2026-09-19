# DeepSeek Harness Tools

Community tools for customizing [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) without maintaining a fork.

This repository currently provides two independent installable bundles:

- **Abyss Theme** — a deep-ocean dark theme with fluorescent royal-blue / cyan accents.
- **Spanish Language Pack** — adds `Español` to the Harness locale selector and translates every locale namespace registered by the Harness client packages, with English fallback for any future key.

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

## Requirements

- DeepSeek Harness with the installable bundle/plugin system.
- A writable Harness profile.
- `git` plus either:
  - global `dsh`; or
  - `pnpm` and a DeepSeek Harness source checkout.

## Repository layout

```text
installers/
  install-theme.sh
  install-spanish.sh
plugins/
  deepseek-abyss-theme/
  deepseek-spanish/
```

## Compatibility

Initial development and smoke validation target DeepSeek Harness `0.1.6-alpha.2` and its current Client extension APIs. The installers fail early when the CLI/profile mechanism is unavailable.

## Author

Created and maintained by **Master-Cas**.

GitHub: https://github.com/Master-Cas

If you use, share, fork, or redistribute these tools, please keep the original attribution to **Master-Cas** and the repository link.

## License

MIT. See [LICENSE](LICENSE).
