import type { Context } from '@deepseek-ai/cordis'
import { en, NS, zh } from './locales.ts'

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-alpha: dictionaries')
}
