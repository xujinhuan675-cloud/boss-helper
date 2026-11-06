import { browser } from '#imports'

export function installExtensionReload() {
  if (!browser.runtime.getManifest().permissions?.includes('nativeMessaging')) return
  const bootId = crypto.randomUUID()
  function connect() {
    try {
      const port = browser.runtime.connectNative('cc.offerhunt.diagnostics')
      port.onMessage.addListener((message) => {
        if (message?.type === 'reload') browser.runtime.reload()
        else if (message?.ok === false) port.disconnect()
      })
      port.onDisconnect.addListener(() => {
        void browser.runtime.lastError
        setTimeout(connect, 5000)
      })
      port.postMessage({
        type: 'reload:watch',
        bootId,
        version: browser.runtime.getManifest().version,
      })
    } catch {
      setTimeout(connect, 5000)
    }
  }
  connect()
}
