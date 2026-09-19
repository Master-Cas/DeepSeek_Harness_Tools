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

/** djb2 over the UTF-16 code units; kept in lockstep with the coverage manifest. */
function hash(value) {
  let h = 5381
  for (const c of value) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0
  return h.toString(16)
}

/** Placeholder names in a template, order-normalized. */
function placeholders(value) {
  return [...String(value).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1])
}

/*
 * Coverage manifest for the Spanish pack: one entry per Harness client locale
 * namespace, with the key count, a hash of the sorted key set, and a hash of
 * each key's placeholder signature. Any dropped/renamed key or lost
 * placeholder fails the smoke test even when a string itself changes.
 */
const ES_MANIFEST = {
  'workflowRun': { n: 18, k: '97a77716', p: '383b8a1' },
  'deliverables': { n: 67, k: 'b6b4eb8e', p: '5ea76a5c' },
  'question': { n: 15, k: 'bcd82a14', p: 'cc463747' },
  'subagent': { n: 39, k: '7c33bda4', p: 'a2e4da33' },
  'sidebarFiles': { n: 13, k: '213d28ca', p: 'd3124f28' },
  'reference': { n: 11, k: 'cb8968df', p: 'cfd0a24' },
  'open-in-app': { n: 39, k: '923a206a', p: 'd2344f96' },
  'model': { n: 22, k: '46f2baa8', p: '6a4afc56' },
  'workspace': { n: 64, k: 'b1c6b070', p: '985222b4' },
  'schedule.catalog': { n: 18, k: '87598c8', p: 'a33f36ff' },
  'sidebarBrowser': { n: 22, k: '668cd248', p: '4a12c486' },
  'command': { n: 28, k: '627ef61e', p: '6e251787' },
  'conversation': { n: 155, k: 'f5a5c0d', p: '23516c5' },
  'pluginManager': { n: 155, k: 'b255cf7a', p: '92a91c3d' },
  'slash.menu': { n: 9, k: '7886184f', p: 'd6688454' },
  'sidebarTerminal': { n: 27, k: '9488b2e3', p: '4c7d4b6a' },
  'settings.plugins': { n: 61, k: '94ba8a94', p: 'dfdd94fd' },
  'settings.pluginInventory': { n: 39, k: 'd93e1ec6', p: 'a1d2095c' },
  'sidebarRight': { n: 21, k: 'e5924f2c', p: '6fc1d5ed' },
  'settings.models': { n: 104, k: '57c2b586', p: '81db06c6' },
  'goal': { n: 12, k: 'adf6b9cd', p: '2507ce89' },
  'feedback': { n: 20, k: '81f16805', p: '6b25f5c9' },
  'trajectory': { n: 184, k: '1b0fca7b', p: 'a0fd58f4' },
  'sidebarDocumentPreview': { n: 19, k: 'c6390ede', p: '4907a76a' },
  'sidebarCodePreview': { n: 3, k: 'df30618a', p: '7610eae1' },
  'documentMarkdown': { n: 4, k: '872b0f85', p: '250a4299' },
  'sidebarImage': { n: 5, k: 'e3cdd8bd', p: 'cba7664f' },
  'sidebarPdf': { n: 9, k: '7f08d289', p: '696b91d0' },
  'documentHtml': { n: 4, k: 'c7a81673', p: '80f58e87' },
  'sidebarOffice': { n: 17, k: '137e3929', p: 'd2e78409' },
  'skill': { n: 7, k: 'ed814e3b', p: '213ce706' },
  'approval': { n: 5, k: '7ec48122', p: '2e55cb32' },
  'chat': { n: 104, k: '287c0d7', p: '17fbc3ff' },
  'plan': { n: 19, k: '55789d3d', p: 'b6552586' },
  'settings.theme': { n: 9, k: 'd0de489a', p: '12fd0cff' },
  'settings': { n: 29, k: 'e483fd7b', p: '7eb1b7ea' },
  'permission.access': { n: 17, k: 'ea28ba0c', p: 'f9bae37a' },
  'settings.permission': { n: 12, k: '895e8e3e', p: '1fb8265a' },
  'settings.archivedSessions': { n: 15, k: '9c06c8d0', p: 'cb4c42cb' },
  'job': { n: 15, k: 'fc51455', p: '97843209' },
  'settings.agentPreset': { n: 57, k: 'aab6ca9f', p: '4550d89' },
  'sidebar': { n: 5, k: '93def7c9', p: 'dffd503a' },
  'directory-browser': { n: 13, k: '41c871f9', p: '2d385093' },
  'common': { n: 37, k: '26d638fc', p: 'f766d189' },
  'settings.locale': { n: 1, k: 'ac4dab79', p: '36031ad6' },
  'agent-team': { n: 35, k: '4bf50b01', p: '8f400498' },
  'session-log-download': { n: 9, k: '2ab72020', p: 'b08c08c5' },
  'cordis': { n: 50, k: '90e215dc', p: '110e73aa' },
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
  // Leaked base-light control surfaces are painted into the abyss palette...
  assert.equal(override.tokens['--dsw-alias-bg-layer-3'].light, '#0B2440')
  assert.equal(override.tokens['--dsw-alias-bg-module-platform'].light, '#0A203A')
  assert.equal(override.tokens['--dsw-alias-button-elevated-fill'].light, '#0A203A')
  assert.equal(override.tokens['--dsw-alias-button-ghost-active-fill'].light, '#12375A')
  assert.equal(override.tokens['--dsw-specific-sidebar-nav-item-active'].light, '#12375A')
  // ...while the dark palette keeps the base values, so dark mode is untouched.
  assert.equal(override.tokens['--dsw-alias-bg-layer-3'].dark, '#353538')
  assert.equal(override.tokens['--dsw-alias-button-elevated-fill'].dark, '#43454A')
  assert.equal(override.tokens['--dsw-alias-label-primary'].dark, '#E7F6FF')

  const css = documentMock.appended[0].textContent
  assert.ok(css.includes('M22.9168 1.43018'))
  // Light/selected controls with the light "primary ink" fill take dark ink.
  assert.ok(css.includes("body:not([data-ds-dark-theme]) [data-tone='solid']"))
  assert.ok(css.includes('color: #05152B'))
  // The light-control contrast fix must also cover dialog selector/menu ink.
  assert.ok(css.includes('body:not([data-ds-dark-theme])'))
  assert.ok(css.includes('aria-haspopup=menu'))
  assert.ok(css.includes('#0B2342'))
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

  const namespaces = Object.keys(ES_MANIFEST)
  assert.equal(namespaces.length, 48)
  assert.equal(dictionaries.size, namespaces.length, 'registered namespace count')
  assert.ok(dictionaries.size >= 40, 'Spanish pack must cover the broad client surface')

  let totalKeys = 0
  for (const namespace of namespaces) {
    const dictionary = dictionaries.get(`${namespace}:es`)
    assert.ok(dictionary, `missing Spanish namespace ${namespace}`)

    const keys = Object.keys(dictionary).sort()
    totalKeys += keys.length
    assert.equal(keys.length, ES_MANIFEST[namespace].n, `${namespace}: key count`)
    assert.equal(hash(keys.join('\n')), ES_MANIFEST[namespace].k, `${namespace}: key set changed`)

    const signature = keys
      .map((key) => `${key}=${placeholders(dictionary[key]).join(',')}`)
      .join('\n')
    assert.equal(hash(signature), ES_MANIFEST[namespace].p, `${namespace}: placeholders changed`)

    for (const key of keys) {
      assert.notEqual(dictionary[key], '', `${namespace}.${key}: empty translation`)
    }
  }
  assert.equal(totalKeys, 1643, 'total Spanish key count')

  // Spot checks across namespaces, including placeholder and technical-term fidelity.
  assert.equal(dictionaries.get('settings.locale:es')['language.title'], 'Idioma')
  assert.equal(dictionaries.get('conversation:es')['input.send'], 'Enviar mensaje')
  assert.equal(dictionaries.get('common:es')['cancel'], 'Cancelar')
  assert.equal(dictionaries.get('common:es')['json.label'], 'JSON')
  assert.equal(dictionaries.get('open-in-app:es')['app.vscode'], 'VS Code')
  assert.equal(dictionaries.get('open-in-app:es')['open.title'], 'Abrir el espacio de trabajo en {app}')
  assert.equal(dictionaries.get('approval:es')['escalation'], 'La herramienta {toolName} solicita ejecución con privilegios')
  assert.equal(dictionaries.get('job:es')['count.live.one'], '{count} tarea en segundo plano en ejecución')
  assert.equal(dictionaries.get('chat:es')['stats.counts'], '{turns} turnos {steps} pasos')
  assert.equal(dictionaries.get('sidebar:es')['session.new'], 'Nueva sesión')
  assert.equal(dictionaries.get('settings.theme:es')['appearance.dark'], 'Oscuro')
  assert.equal(dictionaries.get('workspace:es')['time.ago'], 'hace {t}')
  assert.equal(dictionaries.get('settings.agentPreset:es')['nav'], 'Preajustes de agente')
  assert.equal(dictionaries.get('settings.pluginInventory:es')['globalTitle'], 'Plugins globales')
  assert.equal(dictionaries.get('agent-team:es')['tasks'], 'Tareas compartidas')
  assert.equal(dictionaries.get('session-log-download:es')['menu.download'], 'Descargar registro de la sesión')
  assert.equal(dictionaries.get('cordis:es')['action.run'], 'Ejecutar')
}

{
  const rootManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(rootManifest.version, '0.2.1', 'root package version')
  assert.equal(rootManifest.author?.name, 'Master-Cas', 'root author')
  assert.equal(rootManifest.maintainers?.[0]?.name, 'Master-Cas', 'root maintainer')
  assert.equal(rootManifest['master-cas']?.originalAuthor, 'Master-Cas', 'root original author metadata')

  for (const file of ['AUTHORS.md', 'NOTICE.md', 'CITATION.cff']) {
    const body = fs.readFileSync(path.join(root, file), 'utf8')
    assert.ok(body.includes('Master-Cas'), file + ' must preserve Master-Cas attribution')
  }
}

for (const plugin of ['deepseek-abyss-theme', 'deepseek-spanish']) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugins', plugin, 'package.json'), 'utf8'))
  const patch = fs.readFileSync(path.join(root, 'plugins', plugin, 'cordis.patch.yml'), 'utf8')
  assert.equal(manifest.version, '0.2.1', `${plugin} version`)
  assert.equal(manifest.author?.name, 'Master-Cas', `${plugin} author`)
  assert.equal(manifest.maintainers?.[0]?.name, 'Master-Cas', `${plugin} maintainer`)
  assert.equal(manifest['master-cas']?.originalAuthor, 'Master-Cas', `${plugin} original author metadata`)
  assert.ok(manifest.dsh?.bundle?.patch)
  assert.ok(manifest.dsh?.client?.platform === 'web')
  assert.ok(patch.includes(manifest.name))

  const clientSource = fs.readFileSync(path.join(root, 'plugins', plugin, 'client.js'), 'utf8')
  assert.ok(clientSource.includes('Original author: Master-Cas'), `${plugin} client attribution header`)
}

const generatorSource = fs.readFileSync(path.join(root, 'tools', 'lib', 'generate.mjs'), 'utf8')
assert.ok(generatorSource.includes('Original tooling and generator author: Master-Cas'))
assert.ok(generatorSource.includes("originalAuthor: 'Master-Cas'"))

console.log('DeepSeek Harness Tools smoke tests: PASS')

console.log('DeepSeek Harness Tools smoke tests: PASS')
