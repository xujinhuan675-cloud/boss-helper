import { createHash } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export function reloadPipe(root) {
  const key = createHash('sha256')
    .update(path.resolve(root).toLowerCase())
    .digest('hex')
    .slice(0, 20)
  return `\\\\.\\pipe\\offerhunt-reload-${key}`
}

export function serveReload(pipe, info, reload) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      let input = ''
      socket.setTimeout(2000, () => socket.destroy())
      socket.on('error', () => {})
      const receive = (chunk) => {
        input += chunk.toString('utf8')
        if (input.length <= 1024 && !input.includes('\n')) return
        socket.removeListener('data', receive)
        const valid = input === 'reload\n' || input === 'status\n'
        socket.end(JSON.stringify(valid ? { ok: true, ...info } : { ok: false }), () => {
          if (input === 'reload\n') reload()
        })
      }
      socket.on('data', receive)
    })
    server.once('error', reject)
    server.listen(pipe, () => resolve(server))
  })
}

function request(pipe, command, timeout) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipe, () => socket.write(`${command}\n`))
    let output = ''
    socket.setTimeout(timeout, () => socket.destroy(new Error('Native reload bridge timeout')))
    socket.on('data', (chunk) => {
      output += chunk.toString('utf8')
      if (output.length > 1024) socket.destroy(new Error('Invalid native reload response'))
    })
    socket.on('error', reject)
    socket.on('end', () => {
      try {
        const result = JSON.parse(output)
        if (
          !result.ok ||
          typeof result.bootId !== 'string' ||
          !result.bootId ||
          typeof result.version !== 'string'
        )
          throw new Error('Invalid native reload response')
        resolve(result)
      } catch (error) {
        reject(error)
      } finally {
        socket.destroy()
      }
    })
  })
}

export async function requestReload(pipe, timeout = 15000) {
  const deadline = Date.now() + timeout
  let before
  try {
    before = await request(pipe, 'reload', Math.min(timeout, 2000))
  } catch (error) {
    throw new Error(
      'OfferHunt reload bridge unavailable. Run npm run diagnostics:install, then activate the new extension once.',
      { cause: error },
    )
  }
  while (Date.now() < deadline) {
    await delay(Math.min(100, deadline - Date.now()))
    try {
      const after = await request(
        pipe,
        'status',
        Math.max(1, Math.min(1000, deadline - Date.now())),
      )
      if (after.bootId !== before.bootId) return after
    } catch {
      // Chrome closes the old native host while restarting the extension.
    }
  }
  throw new Error('Reload requested, but extension restart was not confirmed within the timeout.')
}
