/**
 * Security regression tests for static language-pack import.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { catalogFromPlugin } from '../tools/lib/catalog.mjs'
import { buildPluginFiles } from '../tools/lib/generate.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-locale-static-import-'))

function write(name, source) {
  const file = path.join(tmp, name)
  fs.writeFileSync(file, source)
  return file
}

try {
  {
    const files = buildPluginFiles({
      name: '@master-cas/deepseek-xx',
      id: '@master-cas/deepseek-xx',
      version: '0.1.0',
      description: 'static import fixture',
      locale: 'xx',
      label: 'Prueba',
      fallback: 'en',
      namespaces: {
        alpha: { greet: 'Hola {name}', emoji: 'Café ☕' },
        beta: { quote: 'Él dijo: "hola"' },
      },
    })
    const file = write('generated.js', files['client.js'])
    const catalog = catalogFromPlugin(file)
    assert.equal(catalog.id, '@master-cas/deepseek-xx')
    assert.equal(catalog.locale, 'xx')
    assert.equal(catalog.label, 'Prueba')
    assert.equal(catalog.fallback, 'en')
    assert.deepEqual(catalog.namespaces, {
      alpha: { emoji: 'Café ☕', greet: 'Hola {name}' },
      beta: { quote: 'Él dijo: "hola"' },
    })
  }

  {
    const marker = path.join(tmp, 'executed')
    const source = `
import fs from 'node:fs'
fs.writeFileSync(${JSON.stringify(marker)}, 'EXECUTED')
throw new Error('EXECUTED')
window.__ModuleLoader__.load({
  id: '@test/static',
  factory() { return { apply() {} } }
})
ctx.locale.addLanguage({ id: 'xx', label: 'Static', fallback: 'en' })
const NS = 'safe'
const dict = { "hello": "Hola {name}" }
ctx.locale.register(NS, 'xx', dict)
`
    const catalog = catalogFromPlugin(write('side-effect.js', source))
    assert.equal(fs.existsSync(marker), false, 'client.js side effect must never execute')
    assert.equal(catalog.namespaces.safe.hello, 'Hola {name}')
  }

  {
    const source = `
while (true) {}
window.__ModuleLoader__.load({ id: '@test/loop', factory() { return {} } })
ctx.locale.addLanguage({ id: 'xx', label: 'Loop', fallback: 'en' })
const NS = 'loop'
const dict = { hello: 'Hola' }
ctx.locale.register(NS, 'xx', dict)
`
    const catalog = catalogFromPlugin(write('infinite-loop.js', source))
    assert.equal(catalog.namespaces.loop.hello, 'Hola')
  }

  {
    const source = `
window.__ModuleLoader__.load({ id: '@test/dynamic', factory() { return {} } })
ctx.locale.addLanguage({ id: 'xx', label: 'Dynamic', fallback: 'en' })
const make = () => ({ hello: 'Hola' })
const dictionaries = { safe: make() }
for (const [namespace, dictionary] of Object.entries(dictionaries)) {
  ctx.locale.register(namespace, 'xx', dictionary)
}
`
    assert.throws(
      () => catalogFromPlugin(write('dynamic.js', source)),
      /dynamic dictionary expressions|no supported static locale dictionaries/,
    )
  }

  {
    const source = `window.__ModuleLoader__.load({ id: '@test/broken'`
    assert.throws(() => catalogFromPlugin(write('broken.js', source)), /unterminated call expression/)
  }

  console.log('static import security tests: PASS')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
