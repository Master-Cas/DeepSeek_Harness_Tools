/** Deep-ocean theme extension for DeepSeek Harness. */
window.__ModuleLoader__.load({
  id: '@master-cas/deepseek-abyss-theme',
  factory() {
    return {
      inject: ['theme'],
      apply(ctx) {
        const tokens = {
          '--dsw-alias-bg-base': { light: '#06152B', dark: '#020817' },
          '--dsw-alias-bg-layer-1': { light: '#0A203A', dark: '#06152B' },
          '--dsw-alias-bg-layer-2': { light: '#0D2947', dark: '#08203A' },
          '--dsw-alias-bg-overlay': { light: '#102E4D', dark: '#09213B' },
          '--dsw-alias-border-l1': { light: '#174467', dark: '#12375A' },
          '--dsw-alias-border-l2': { light: '#22638B', dark: '#18517B' },
          '--dsw-alias-brand-primary': { light: '#246BFF', dark: '#2F7BFF' },
          '--dsw-alias-label-primary': { light: '#E7F6FF', dark: '#E7F6FF' },
          '--dsw-alias-label-secondary': { light: '#9DC2DA', dark: '#8EB4CE' },
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
          `
          document.head.append(style)
          return () => style.remove()
        }, 'master-cas: abyss visual accents')
      }
    }
  }
})
