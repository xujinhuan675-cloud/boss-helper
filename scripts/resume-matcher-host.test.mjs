import assert from 'node:assert/strict'
import childProcess, { spawn } from 'node:child_process'
import { afterEach, mock, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { startResumeMatcher } from './resume-matcher-host.mjs'

afterEach(() => mock.restoreAll())

test('launches only the fixed PowerShell script and waits for it to report readiness', async () => {
  let finish
  let invocation
  mock.method(childProcess, 'execFile', (file, args, options, callback) => {
    invocation = { file, args, options }
    finish = callback
  })
  let completed = false
  const pending = startResumeMatcher({ type: 'start' }).then((result) => {
    completed = true
    return result
  })
  await Promise.resolve()
  assert.equal(completed, false)
  assert.equal(invocation.file, 'powershell.exe')
  const script = invocation.args[invocation.args.indexOf('-File') + 1]
  assert.equal(script, fileURLToPath(new URL('./start-resume-matcher.ps1', import.meta.url)))
  assert(!invocation.args.includes('-NoExit'))
  assert.equal(invocation.options.windowsHide, true)
  assert(invocation.options.timeout >= 240_000)
  finish(null)
  assert.deepEqual(await pending, { ok: true })
})

test('rejects arbitrary paths and commands without running a process', async () => {
  const launch = mock.method(childProcess, 'execFile', () => assert.fail('unexpected execution'))
  for (const message of [null, {}, { type: 'stop' }, { type: 'start', path: 'other.cmd' }]) {
    await assert.rejects(startResumeMatcher(message))
  }
  assert.equal(launch.mock.callCount(), 0)
})

test('a failed launcher never reports healthy service', async () => {
  mock.method(childProcess, 'execFile', (_file, _args, _options, callback) => {
    callback(new Error('PowerShell failed'))
  })
  await assert.rejects(startResumeMatcher({ type: 'start' }))
})

test('native framing rejects a foreign origin and unrecognized command', async () => {
  const host = fileURLToPath(new URL('./resume-matcher-host.mjs', import.meta.url))
  async function request(origin, message) {
    const child = spawn(process.execPath, [host, origin], {
      windowsHide: true,
    })
    const output = []
    child.stdout.on('data', (chunk) => output.push(chunk))
    child.stderr.resume()
    child.stdin.on('error', () => {})
    const closed = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => resolve({ code, output: Buffer.concat(output) }))
    })
    const body = Buffer.from(JSON.stringify(message))
    const header = Buffer.alloc(4)
    header.writeUInt32LE(body.length)
    child.stdin.write(header.subarray(0, 2))
    child.stdin.write(Buffer.concat([header.subarray(2), body.subarray(0, 2)]))
    child.stdin.end(body.subarray(2))
    return closed
  }
  const foreign = await request('chrome-extension://foreign/', { type: 'start' })
  assert.notEqual(foreign.code, 0)
  assert.equal(foreign.output.length, 0)
  const rejected = await request('chrome-extension://ogkmgjbagackkdlcibcailacnncgonbn/', {
    type: 'start',
    command: 'other.cmd',
  })
  assert.equal(rejected.code, 0)
  assert.equal(rejected.output.readUInt32LE(0), rejected.output.length - 4)
  assert.equal(JSON.parse(rejected.output.subarray(4)).ok, false)
})
