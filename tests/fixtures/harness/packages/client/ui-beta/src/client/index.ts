const NS = 'beta'

export function apply(ctx: any): void {
  ctx.effect(() => ctx.locale.register(NS, {
    zh: { ok: '好', count: '{n} 项' },
    en: { ok: 'OK', count: '{n} items' },
  }), 'ui-beta: dictionaries')
}
