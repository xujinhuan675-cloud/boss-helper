import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { requestReload, serveReload } from './extension-reload.mjs'

const address = () =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\offerhunt-test-${randomUUID()}`
    : path.join(os.tmpdir(), `offerhunt-${randomUUID()}.sock`)
const close = (server) => new Promise((resolve) => server.close(resolve))

test('reload succeeds only after a new extension boot connects', async () => {
  const pipe = address()
  let server = await serveReload(pipe, { bootId: 'first', version: 'test' }, () => {
    void close(server).then(async () => {
      server = await serveReload(pipe, { bootId: 'second', version: 'test' }, () => {})
    })
  })
  try {
    const result = await requestReload(pipe, 2000)
    assert.equal(result.bootId, 'second')
    assert.equal(result.version, 'test')
  } finally {
    await close(server)
  }
})

test('native host reconnecting with the same extension boot is not success', async () => {
  const pipe = address()
  const server = await serveReload(pipe, { bootId: 'same', version: 'test' }, () => {})
  try {
    await assert.rejects(requestReload(pipe, 250), /restart was not confirmed/)
  } finally {
    await close(server)
  }
})

test('unknown or oversized commands cannot trigger reload', async () => {
  const pipe = address()
  let reloads = 0
  const server = await serveReload(pipe, { bootId: 'first', version: 'test' }, () => reloads++)
  try {
    for (const command of ['anything\n', `${'a'.repeat(1025)}\n`]) {
      const response = await new Promise((resolve, reject) => {
        const socket = net.connect(pipe, () => socket.end(command))
        let output = ''
        socket.on('data', (chunk) => (output += chunk))
        socket.on('end', () => resolve(JSON.parse(output)))
        socket.on('error', reject)
      })
      assert.equal(response.ok, false)
    }
    assert.equal(reloads, 0)
  } finally {
    await close(server)
  }
})

test('missing native bridge gives an actionable error', async () => {
  await assert.rejects(requestReload(address(), 100), /diagnostics:install/)
})
