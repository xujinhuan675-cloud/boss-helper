import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { reloadPipe, requestReload } from './extension-reload.mjs'

const host = fileURLToPath(new URL('./diagnostics-host.mjs', import.meta.url))
const origin = 'chrome-extension://ogkmgjbagackkdlcibcailacnncgonbn/'
const event = {
  id: 'one',
  time: '2026-10-18T00:00:00Z',
  source: 'boss',
  operation: 'page.restriction',
  level: 'warning',
  error: 'token=secret',
  context: { status: 'captcha', cookie: 'private' },
}

async function run(dir, message, sender = origin) {
  const child = spawn(process.execPath, [host, sender], {
    env: { ...process.env, LOCALAPPDATA: dir },
    windowsHide: true,
  })
  const chunks = []
  let stderr = ''
  child.stdout.on('data', (chunk) => chunks.push(chunk))
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output: Buffer.concat(chunks), stderr }))
  })
  child.stdin.on('error', () => {})
  const body = Buffer.from(JSON.stringify(message))
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length)
  child.stdin.write(header.subarray(0, 2))
  child.stdin.write(Buffer.concat([header.subarray(2), body.subarray(0, 7)]))
  child.stdin.end(body.subarray(7))
  return done
}

test('native host validates the sender and snapshot, redacts records and replaces the fixed file atomically', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'offerhunt-diagnostics-'))
  const target = path.join(dir, 'OfferHunt', 'diagnostics', 'latest.json')
  try {
    const rejected = await run(dir, { events: [event] }, 'chrome-extension://foreign/')
    assert.notEqual(rejected.code, 0)
    await assert.rejects(readFile(target))
    const result = await run(dir, { type: 'snapshot', version: 'test', events: [event] })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.output.readUInt32LE(0), result.output.length - 4)
    assert.equal(JSON.parse(result.output.subarray(4)).ok, true)
    const snapshot = JSON.parse(await readFile(target, 'utf8'))
    assert.equal(snapshot.events[0].error, 'token=[redacted]')
    assert.deepEqual(snapshot.events[0].context, { status: 'captcha' })
    assert.ok(snapshot.exportedAt)
    const invalid = await run(dir, { type: 'snapshot', events: 'wrong' })
    assert.equal(JSON.parse(invalid.output.subarray(4)).ok, false)
    assert.equal(JSON.parse(await readFile(target, 'utf8')).events.length, 1)
    await run(dir, { type: 'snapshot', version: 'test', events: [] })
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')).events, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('real native framing delivers reload and confirms a newly connected extension boot', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'offerhunt-reload-'))
  const children = []
  const start = (onReload) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [host, origin], {
        env: { ...process.env, LOCALAPPDATA: dir },
        windowsHide: true,
      })
      children.push(child)
      let input = Buffer.alloc(0)
      child.on('error', reject)
      child.stdout.on('data', (chunk) => {
        input = Buffer.concat([input, chunk])
        while (input.length >= 4 && input.length >= 4 + input.readUInt32LE(0)) {
          const length = input.readUInt32LE(0)
          const message = JSON.parse(input.subarray(4, 4 + length))
          input = input.subarray(4 + length)
          if (message.type === 'reload:ready') resolve(child)
          else if (message.type === 'reload') onReload(child)
          else reject(new Error(JSON.stringify(message)))
        }
      })
      const body = Buffer.from(
        JSON.stringify({ type: 'reload:watch', bootId: randomUUID(), version: 'test' }),
      )
      const header = Buffer.alloc(4)
      header.writeUInt32LE(body.length)
      child.stdin.write(Buffer.concat([header, body]))
    })
  try {
    let restart
    await start((child) => {
      restart = new Promise((resolve, reject) => {
        child.once('close', () => start(() => {}).then(resolve, reject))
        child.stdin.end()
      })
    })
    const result = await requestReload(reloadPipe(path.join(dir, 'OfferHunt', 'diagnostics')), 3000)
    assert.equal(result.version, 'test')
    await restart
  } finally {
    await Promise.all(
      children
        .filter((child) => child.exitCode === null)
        .map(
          (child) =>
            new Promise((resolve) => {
              child.once('close', resolve)
              child.kill()
            }),
        ),
    )
    await rm(dir, { recursive: true, force: true })
  }
})
