const LOCALE_NS = 'gamma'

export function apply(ctx: any): void {
  ctx.effect(() => {
    const dictionaries: [locale: string, dict: Record<string, string>][] = [
      ['zh', { hello: '你好' }],
      ['en', { hello: 'Hello', bye: 'Bye {who}' }],
    ]
    for (const [locale, dict] of dictionaries) ctx.locale.register(LOCALE_NS, locale, dict)
  }, 'ui-gamma: dictionaries')
}
