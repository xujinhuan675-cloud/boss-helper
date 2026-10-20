import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const { name, version } = readJson('package.json')

assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
assert(version.split('.').every((part) => Number(part) <= 65535) && version !== '0.0.0')

process.env.NODE_ENV = 'production'
const { prepare, zip } = await import('wxt')
await prepare({ root })
const result = spawnSync(process.execPath, ['node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit'], {
  cwd: root,
  stdio: 'inherit',
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

await zip({
  root,
  browser: 'chrome',
  mode: 'production',
  outDirTemplate: 'chrome-mv3-store',
  zip: { artifactTemplate: '{{name}}-{{packageVersion}}-chrome-store.zip', zipSources: false },
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      delete manifest.key
      delete manifest.update_url
      manifest.permissions = manifest.permissions?.filter(
        (permission) => permission !== 'nativeMessaging',
      )
    },
  },
})

const manifest = readJson('.output/chrome-mv3-store/manifest.json')
assert.equal(manifest.manifest_version, 3)
assert.equal(manifest.version, version)
assert.equal(manifest.key, undefined)
assert.equal(manifest.update_url, undefined)
assert(!manifest.permissions.includes('nativeMessaging'))
assert.equal(
  readFileSync(join(root, '.output/chrome-mv3-store/LICENSE'), 'utf8'),
  readFileSync(join(root, 'LICENSE'), 'utf8'),
)
const archive = join(root, `.output/${name}-${version}-chrome-store.zip`)
assert(statSync(archive).size > 0)
// Async removal handles this workspace's Unicode Windows path correctly.
await rm(join(root, '.output/chrome-mv3-store'), { recursive: true, force: true })
assert(
  !existsSync(join(root, '.output/chrome-mv3-store')),
  'Store staging directory was not removed',
)
console.log(`Chrome store package verified: ${archive}`)
