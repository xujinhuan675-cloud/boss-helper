import { browser } from '#imports'

import { RESUME_MATCHER_BASE_URL } from './resumeMatcher'

export function canStartResumeMatcher() {
  return browser.runtime.getManifest().permissions?.includes('nativeMessaging') ?? false
}

export async function startAndOpenResumeMatcher() {
  if (!canStartResumeMatcher()) throw new Error('此功能需要本机 Chrome 扩展版本')
  let result: { ok?: boolean } | undefined
  try {
    result = await browser.runtime.sendNativeMessage('cc.offerhunt.resume_matcher', {
      type: 'start',
    })
  } catch {
    throw new Error('无法连接本机启动入口，请在仓库运行 npm run diagnostics:install 后重试')
  }
  if (result?.ok !== true)
    throw new Error('定制简历服务启动失败，请双击 start-resume-matcher.cmd 查看错误')
  await browser.tabs.create({ url: `${RESUME_MATCHER_BASE_URL}/tailor` })
}
