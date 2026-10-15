import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('WXT prepares entrypoints and exits without browser runtime side effects', () => {
  const result = spawnSync(process.execPath, ['node_modules/wxt/bin/wxt.mjs', 'prepare'], {
    cwd: dirname(fileURLToPath(new URL('../package.json', import.meta.url))),
    encoding: 'utf8',
    timeout: 30000,
  })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /Counter has not been initialized/)
})
