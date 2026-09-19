/** Deep-ocean theme extension for DeepSeek Harness. */
window.__ModuleLoader__.load({
  id: '@master-cas/deepseek-abyss-theme',
  factory() {
    return {
      inject: ['theme'],
      apply(ctx) {
        // Abyss palette. `light`/`dark` select the base palette the value is
        // applied over; both resolve to deep-ocean surfaces, so the theme
        // stays dark whichever appearance the user picks. The `dark` column
        // mirrors the base dark palette for every token the base theme
        // already painted sensibly, so dark appearance is unchanged.
        const tokens = {
          '--dsw-alias-bg-base': { light: '#06152B', dark: '#020817' },
          '--dsw-alias-bg-layer-1': { light: '#0A203A', dark: '#06152B' },
          '--dsw-alias-bg-layer-2': { light: '#0D2947', dark: '#08203A' },
          // The base light palette leaves popup cards white (the `menu`
          // surface aliases layer-3). A dark value fixes them for the light
          // abyss ink *and* is the ink drawn on the light "primary" fills —
          // solid tags, save chips, badges, tips — so those light/selected
          // controls get dark text and currentColor icons too.
          '--dsw-alias-bg-layer-3': { light: '#0B2440', dark: '#353538' },
          '--dsw-alias-bg-overlay': { light: '#102E4D', dark: '#09213B' },
          '--dsw-alias-bg-module-platform': { light: '#0A203A', dark: '#353538' },
          '--dsw-alias-border-l1': { light: '#174467', dark: '#12375A' },
          '--dsw-alias-border-l2': { light: '#22638B', dark: '#18517B' },
          // Black-transparent hairlines vanish on the abyss surfaces; the
          // light column lifts them and the dark column keeps the base value.
          '--dsw-alias-border-l3': { light: 'rgba(127, 166, 196, .24)', dark: 'rgba(255, 255, 255, .16)' },
          '--dsw-alias-border-l4': { light: 'rgba(127, 166, 196, .34)', dark: 'rgba(255, 255, 255, .2)' },
          // Selected/raised control fills the base light palette ships near
          // white. Dark abyss values keep the light ink legible instead of
          // leaving pale text on a white fill.
          '--dsw-alias-button-elevated-fill': { light: '#0A203A', dark: '#43454A' },
          '--dsw-alias-button-floating-fill': { light: '#0D2947', dark: '#2C2C2E' },
          '--dsw-alias-button-floating-hover': { light: '#12375A', dark: '#353538' },
          '--dsw-alias-button-ghost-active-fill': { light: '#12375A', dark: '#43454A' },
          '--dsw-alias-button-ghost-active-hover': { light: '#174467', dark: '#61666B' },
          '--dsw-alias-button-ghost-active-border': { light: '#22638B', dark: '#81858C' },
          '--dsw-alias-button-primary-dimmed': { light: '#0D2947', dark: '#43454A' },
          '--dsw-alias-interactive-bg-hover-solid': { light: '#0D2947', dark: '#353538' },
          '--dsw-specific-selector': { light: '#0A203A', dark: '#353538' },
          '--dsw-specific-sidebar-nav-item-active': { light: '#12375A', dark: '#43454A' },
          '--dsw-specific-sidebar-nav-item-hover': { light: '#0D2947', dark: '#2C2C2E' },
          '--dsw-specific-sidebar-nav-item-active-accent': { light: '#174467', dark: '#353538' },
          '--dsw-specific-bubble': { light: '#0A203A', dark: '#2C2C2E' },
          '--dsw-specific-bubble-highlight': { light: '#12375A', dark: '#43454A' },
          '--dsw-specific-input-major': { light: '#0A203A', dark: '#2C2C2E' },
          '--dsw-specific-login-input': { light: '#0B2440', dark: '#1B1B1C' },
          '--dsw-specific-tip': { light: '#0D2947', dark: '#353538' },
          // Markdown payload surfaces (code blocks, inline code, tags).
          '--dsw-alias-markdown-code-block': { light: '#0A203A', dark: '#1B1B1C' },
          '--dsw-alias-markdown-code-block-banner': { light: '#0B2440', dark: '#2C2C2E' },
          '--dsw-alias-markdown-inline-code': { light: '#0D2947', dark: '#292929' },
          '--dsw-alias-markdown-tag': { light: '#0D2947', dark: '#2C2C2E' },
          '--dsw-alias-markdown-citation': { light: '#0B2440', dark: '#353538' },
          '--dsw-alias-markdown-placeholder': { light: '#0B2440', dark: '#2C2C2E' },
          '--dsw-alias-markdown-code-segment-selected': { light: '#08203A', dark: '#353538' },
          '--dsw-alias-markdown-code-segment-unselected': { light: '#0A203A', dark: '#1B1B1C' },
          // Text and brand accents.
          '--dsw-alias-brand-primary': { light: '#246BFF', dark: '#2F7BFF' },
          '--dsw-alias-label-primary': { light: '#E7F6FF', dark: '#E7F6FF' },
          '--dsw-alias-label-secondary': { light: '#9DC2DA', dark: '#8EB4CE' },
          // Tertiary/caption text sat on the base light greys, illegible on
          // the abyss surfaces; lift the light column, keep the dark one.
          '--dsw-alias-label-tertiary': { light: '#7FA6C4', dark: '#ADB2B8' },
          '--dsw-alias-label-caption': { light: '#6E93B0', dark: '#81858C' },
          '--dsw-alias-state-error-primary': { light: '#FF557A', dark: '#FF557A' },
          '--dsw-alias-state-success-primary': { light: '#45F0E7', dark: '#45F0E7' },
          '--dsw-alias-state-warn-primary': { light: '#FFD166', dark: '#FFD166' },
          '--dsw-specific-sidebar-fill': { light: '#071A31', dark: '#030D20' }
        }

        ctx.effect(
          () => ctx.theme.overrideTokens('master-cas-abyss-theme', tokens),
          'master-cas: abyss theme tokens'
        )

        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.deepseekAbyssTheme = 'true'
          style.textContent = `
            :root {
              --deephost-neon-blue: #2F7BFF;
              --deephost-neon-cyan: #00D9FF;
              --deephost-biolume: #45F0E7;
            }

            /* Existing DeepSeek whale/fish silhouette: recolor only, keep geometry. */
            svg path[d^="M22.9168 1.43018"] {
              fill: var(--deephost-neon-blue) !important;
              filter:
                drop-shadow(0 0 3px rgba(47, 123, 255, .78))
                drop-shadow(0 0 8px rgba(0, 217, 255, .24));
            }

            ::selection {
              background: rgba(47, 123, 255, .42);
              color: #F3FBFF;
            }

            :focus-visible {
              outline-color: var(--deephost-neon-cyan) !important;
            }

            a {
              text-decoration-color: rgba(0, 217, 255, .48);
            }

            /* The Harness light palette keeps several selector/selected dialog
               surfaces near-white. Abyss keeps the surrounding page navy, so
               those light controls need their own dark ink instead of
               inheriting pale text. Scoped to the light base scheme only. */
            body:not([data-ds-dark-theme]) [role="dialog"] button[aria-haspopup=menu],
            body:not([data-ds-dark-theme]) [role="dialog"] button[aria-pressed="true"],
            body:not([data-ds-dark-theme]) [role="dialog"] button[aria-current="true"] {
              --dsw-alias-label-primary: #0B2342;
              --dsw-alias-label-secondary: #1D3A55;
              --dsw-alias-label-caption: #55778D;
              color: #0B2342 !important;
            }

            body:not([data-ds-dark-theme]) [role="dialog"] button[aria-haspopup=menu] svg,
            body:not([data-ds-dark-theme]) [role="dialog"] button[aria-pressed="true"] svg,
            body:not([data-ds-dark-theme]) [role="dialog"] button[aria-current="true"] svg {
              color: currentColor !important;
            }

            /* Controls that paint the light "primary ink" as their fill (solid
               tags, save chips, badges, tips) keep that light fill; pin their
               text and currentColor glyphs to the deep abyss ink for contrast.
               Scoped to the light base palette so the dark palette, which
               already pairs those fills with dark ink, is untouched. */
            body:not([data-ds-dark-theme]) [data-tone='solid'] {
              color: #05152B;
            }

            body:not([data-ds-dark-theme]) [data-tone='solid'] svg {
              color: inherit;
              fill: currentColor;
            }
          `
          document.head.append(style)
          return () => style.remove()
        }, 'master-cas: abyss visual accents')
      }
    }
  }
})
