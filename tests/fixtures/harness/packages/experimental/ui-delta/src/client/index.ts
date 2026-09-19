import { DELTA_NS, deltaEn, deltaZh } from './locales.ts'

export function apply(ctx: any): void {
  ctx.effect(() => ctx.locale.register(DELTA_NS, { zh: deltaZh, en: deltaEn }), 'ui-delta: dictionaries')
}
