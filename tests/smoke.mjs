import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadClient(relativePath, documentMock = undefined) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
  let registration
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value) {
          registration = value
        },
      },
    },
    document: documentMock,
  }
  vm.runInNewContext(source, sandbox, { filename: relativePath })
  assert.ok(registration, `${relativePath} did not register with __ModuleLoader__`)
  return registration
}

function createDocumentMock() {
  const appended = []
  return {
    head: {
      append(node) {
        appended.push(node)
      },
    },
    createElement(tag) {
      assert.equal(tag, 'style')
      return {
        dataset: {},
        textContent: '',
        remove() {},
      }
    },
    appended,
  }
}

{
  const documentMock = createDocumentMock()
  const registration = loadClient('plugins/deepseek-abyss-theme/client.js', documentMock)
  assert.equal(registration.id, '@master-cas/deepseek-abyss-theme')

  let override
  const effects = []
  const plugin = registration.factory()
  plugin.apply({
    theme: {
      overrideTokens(source, tokens) {
        override = { source, tokens }
        return () => {}
      },
    },
    effect(fn) {
      effects.push(fn())
    },
  })

  assert.equal(override.source, 'master-cas-abyss-theme')
  assert.equal(override.tokens['--dsw-alias-bg-base'].dark, '#020817')
  assert.equal(override.tokens['--dsw-alias-brand-primary'].dark, '#2F7BFF')
  assert.ok(documentMock.appended[0].textContent.includes('M22.9168 1.43018'))
}

{
  const registration = loadClient('plugins/deepseek-spanish/client.js')
  assert.equal(registration.id, '@master-cas/deepseek-spanish')

  let language
  const dictionaries = new Map()
  const plugin = registration.factory()
  plugin.apply({
    locale: {
      addLanguage(value) {
        language = value
        return () => {}
      },
      register(namespace, locale, dictionary) {
        dictionaries.set(`${namespace}:${locale}`, dictionary)
        return () => {}
      },
    },
    effect(fn) {
      fn()
    },
  })

  assert.deepEqual(
    JSON.parse(JSON.stringify(language)),
    { id: 'es', label: 'Español', fallback: 'en' },
  )
  for (const namespace of [
    'common',
    'settings.locale',
    'settings.theme',
    'settings',
    'sidebar',
    'workspace',
    'model',
    'conversation',
    'command',
    'goal',
    'settings.models',
  ]) {
    assert.ok(dictionaries.has(`${namespace}:es`), `missing Spanish namespace ${namespace}`)
  }
  assert.equal(dictionaries.get('settings.locale:es')['language.title'], 'Idioma')
  assert.equal(dictionaries.get('conversation:es')['input.send'], 'Enviar mensaje')
}

for (const plugin of ['deepseek-abyss-theme', 'deepseek-spanish']) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugins', plugin, 'package.json'), 'utf8'))
  const patch = fs.readFileSync(path.join(root, 'plugins', plugin, 'cordis.patch.yml'), 'utf8')
  assert.ok(manifest.dsh?.bundle?.patch)
  assert.ok(manifest.dsh?.client?.platform === 'web')
  assert.ok(patch.includes(manifest.name))
}

console.log('DeepSeek Harness Tools smoke tests: PASS')
