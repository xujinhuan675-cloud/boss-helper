import childProcess from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const origin = 'chrome-extension://ogkmgjbagackkdlcibcailacnncgonbn/'
const launcher = fileURLToPath(new URL('./start-resume-matcher.ps1', import.meta.url))

export async function startResumeMatcher(message) {
  if (message?.type !== 'start' || Object.keys(message).length !== 1)
    throw new Error('Invalid startup command')
  await new Promise((resolve, reject) => {
    childProcess.execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher],
      { windowsHide: true, timeout: 270_000 },
      (error) => (error ? reject(error) : resolve()),
    )
  })
  return { ok: true }
}

async function serve() {
  if (process.argv[2] !== origin) throw new Error('Unauthorized extension origin')
  let input = Buffer.alloc(0)
  let result = { ok: false }
  try {
    for await (const chunk of process.stdin) {
      input = Buffer.concat([input, chunk])
      if (input.length < 4) continue
      const length = input.readUInt32LE(0)
      if (length === 0 || length > 1024) break
      if (input.length < length + 4) continue
      result = await startResumeMatcher(JSON.parse(input.subarray(4, length + 4).toString('utf8')))
      break
    }
  } catch {
    result = { ok: false }
  }
  const body = Buffer.from(JSON.stringify(result))
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length)
  process.stdout.write(Buffer.concat([header, body]))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await serve()
