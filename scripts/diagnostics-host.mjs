import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeDiagnostic } from '../src/utils/diagnostics.ts'
import { reloadPipe, requestReload, serveReload } from './extension-reload.mjs'

const hostName = 'cc.offerhunt.diagnostics'
const origin = 'chrome-extension://ogkmgjbagackkdlcibcailacnncgonbn/'
const root = path.join(process.env.LOCALAPPDATA || '', 'OfferHunt', 'diagnostics')
const target = path.join(root, 'latest.json')
const command = process.argv[2]

if (!process.env.LOCALAPPDATA) throw new Error('Windows LOCALAPPDATA is required')
if (command === '--install') {
  if (process.platform !== 'win32') throw new Error('Installation supports Windows Chrome only')
  await mkdir(root, { recursive: true })
  const quote = (value) => `"${value.replaceAll('%', '%%')}"`
  const hosts = [
    {
      name: hostName,
      file: 'native-host',
      launcher: 'run-host',
      script: fileURLToPath(import.meta.url),
      description: 'OfferHunt redacted diagnostics mirror',
    },
    {
      name: 'cc.offerhunt.resume_matcher',
      file: 'resume-matcher-host',
      launcher: 'run-resume-matcher',
      script: fileURLToPath(new URL('./resume-matcher-host.mjs', import.meta.url)),
      description: 'OfferHunt Resume Matcher launcher',
    },
  ]
  for (const host of hosts) {
    const launcher = path.join(root, `${host.launcher}.cmd`)
    const manifest = path.join(root, `${host.file}.json`)
    await writeFile(
      launcher,
      `@echo off\r\nchcp 65001 >nul\r\n${quote(process.execPath)} ${quote(host.script)} %*\r\n`,
      'utf8',
    )
    await writeFile(
      manifest,
      JSON.stringify(
        {
          name: host.name,
          description: host.description,
          path: launcher,
          type: 'stdio',
          allowed_origins: [origin],
        },
        null,
        2,
      ),
      'utf8',
    )
    execFileSync(
      'reg.exe',
      [
        'add',
        `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${host.name}`,
        '/ve',
        '/t',
        'REG_SZ',
        '/d',
        manifest,
        '/f',
      ],
      { windowsHide: true, stdio: 'pipe' },
    )
  }
  console.log(JSON.stringify({ ok: true, host: hostName, path: target, node: process.execPath }))
} else if (command === '--reload') {
  try {
    const result = await requestReload(reloadPipe(root))
    console.log(JSON.stringify({ ok: true, extensionId: origin.split('/')[2], ...result }))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
} else if (command === '--read') {
  try {
    process.stdout.write(await readFile(target, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    console.error('No diagnostics snapshot yet. Reload OfferHunt or use its log sync action.')
    process.exitCode = 1
  }
} else {
  if (command !== origin) throw new Error('Unauthorized extension origin')
  let input = Buffer.alloc(0)
  let expected
  let complete = false
  const respond = (result) => {
    const body = Buffer.from(JSON.stringify(result))
    const header = Buffer.alloc(4)
    header.writeUInt32LE(body.length)
    process.stdout.write(Buffer.concat([header, body]))
  }
  process.stdin.on('data', (chunk) => {
    if (complete) return
    input = Buffer.concat([input, chunk])
    if (expected === undefined && input.length >= 4) {
      expected = input.readUInt32LE(0)
      if (expected > 2 * 1024 * 1024 || expected === 0) {
        complete = true
        respond({ ok: false, error: 'Invalid message length' })
        return
      }
    }
    if (expected === undefined || input.length < expected + 4) return
    complete = true
    void (async () => {
      try {
        const message = JSON.parse(input.subarray(4, expected + 4).toString('utf8'))
        if (message?.type === 'reload:watch') {
          if (!/^[\da-f-]{36}$/.test(message.bootId) || typeof message.version !== 'string')
            throw new Error('Invalid reload registration')
          const server = await serveReload(
            reloadPipe(root),
            { bootId: message.bootId, version: message.version.slice(0, 80) },
            () => respond({ type: 'reload' }),
          )
          if (process.stdin.readableEnded) server.close()
          else process.stdin.on('end', () => server.close())
          respond({ type: 'reload:ready' })
          return
        }
        if (message?.type !== 'snapshot' || !Array.isArray(message.events))
          throw new Error('Invalid snapshot')
        const events = message.events.slice(-200).map(normalizeDiagnostic)
        if (events.some((event) => !event)) throw new Error('Invalid diagnostic event')
        const exportedAt = new Date().toISOString()
        const snapshot = {
          schemaVersion: 1,
          version: typeof message.version === 'string' ? message.version.slice(0, 80) : '',
          exportedAt,
          events,
        }
        await mkdir(root, { recursive: true })
        const temporary = path.join(root, `latest-${process.pid}.tmp`)
        await writeFile(temporary, JSON.stringify(snapshot, null, 2), 'utf8')
        await rename(temporary, target)
        respond({ ok: true, path: target, exportedAt })
      } catch {
        respond({ ok: false, error: 'Diagnostics snapshot could not be saved' })
      }
    })()
  })
}
