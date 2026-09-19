/**
 * Fixture namespace that exports `NS` from the dictionary module, mirroring
 * the real ui-commands/ui-workflow-run registration shape.
 */
export const NS = 'alpha'

export const zh = {
  'title': '甲',
  'greet': '你好 {name}',
} satisfies Record<string, string>

export const en = {
  'title': 'Alpha',
  'greet': 'Hello {name}',
} satisfies Record<string, string>
