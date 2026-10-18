import { resolve } from 'path'

import ui from '@nuxt/ui/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'wxt'

import { version } from './package.json'

const matches = ['*://zhipin.com/*', '*://*.zhipin.com/*']
const icons = {
  16: 'icons/logo.png',
  32: 'icons/logo.png',
  48: 'icons/logo.png',
  128: 'icons/logo.png',
}

export default defineConfig({
  srcDir: 'src',
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
  modules: ['@wxt-dev/module-vue'],
  // imports: false,

  vite: () => ({
    resolve: {
      alias: {
        'devlog-ui': resolve(__dirname, 'packages/devlog-ui/src'),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(version),
      // The extension bundles content scripts as IIFE; this keeps devlog-ui's optional Vite env probe warning-free there.
      'import.meta': '{}',
    },
    build: {
      rollupOptions: {
        onwarn(warning, warn) {
          if (warning.code === 'INVALID_ANNOTATION') return
          warn(warning)
        },
      },
    },
    ssr: {
      noExternal: [
        '@webext-core/storage',
        '@webext-core/messaging',
        '@webext-core/proxy-service',
        '@nuxt/ui',
        '@nuxt/icon',
      ],
    },
    plugins: [
      react({ include: /src\/workbench\/.*\.[jt]sx$/ }),
      // 业务服务仍使用 Nuxt UI 的 useToast 自动导入，不再注册旧界面组件。
      ui({ colorMode: false, router: false, prose: false, components: false }),
    ],
  }),
  dev: {},
  manifest: ({ browser }) => ({
    default_locale: 'zh_CN',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    icons,
    permissions: ['storage', 'notifications', ...(browser === 'firefox' ? [] : ['sidePanel'])],
    action: { default_title: '打开 OfferHunt 侧边栏', default_icon: icons },
    web_accessible_resources: [
      {
        resources: ['boss.js'],
        matches,
      },
    ],
    host_permissions: ['http://*/*', 'https://*/*'],
    key:
      browser === 'edge'
        ? undefined // 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq+hJAUmfZSTB6c7QOXiU6r1JUMLM3C/CDTVolB5pU/DAkO3Y3uVh/YWWaV8m2wIrLSjN7n1CZ+zmRlO+YpUq2vZRILq8WXFePCfHe8EqVY9mjj04BqqRuttHpJqMeXl1aVbKmICKj3cNEprGzJJvaAorz0NJxD82oLXf8CMIW0MHUjvwgmNc9HTD41glvX6CzW1r4qvwl4MSdZRPVf5dmhp+CWoaAcjqEpHbu+EZV5WpfQz9XCsmBXmMAFLyBtn62Xvy86c9PntIRw8xMikqmi8lVyOgT8oSM2U8EFyMsESoT2qCQXgUf0FMtKipoNs7xM7FtdOppNylHa6jJyYdRwIDAQAB'
        : browser === 'chrome'
          ? 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxCHedeutoVPRmAkHsKoev5NdPRNcre8U1Z7a1MbceU7BQRIkMhiIApkBpvoTW30dcUQ/V3UOB6v4Crvkr40Hjr8u1uygcWynl12/+gIcNriIKgZh+udWCkKCFHs5pFEdoXUaQqym+eEBkJCo5HwgxYkxXA94/a2Vtnd5u7Mk0nWyk40qx1wxATYEi10C5L82U32F6KgvIY7YqhtFaM9N2utW4rlbtMgeEOEANG6fo4IBhEM/+n5kbch5K2KAH70fMKUq9aOj43b3gTM4mT90tF1jfMRgLW26d6zfUhMQBG2SqQSc6AoN25r+Q5D79OcezUE1S8iBkzb1MM2GfkFxJQIDAQAB'
          : undefined,
    browser_specific_settings:
      browser == 'firefox'
        ? {
            gecko: {
              id: '{1b66669d-c871-43f3-8c0c-d8a1c0566071}',
              strict_min_version: '109.0',
            },
          }
        : undefined,
  }),
  webExt: {
    disabled: true,
  },
  // hooks: {
  //   'build:manifestGenerated': (wxt, manifest) => {
  //     manifest.content_scripts ??= []
  //     manifest.content_scripts.push({
  //       // Build extension once to see where your CSS get's written to
  //       css: ['/assets/main-world.css'],
  //       matches,
  //     })
  //   },
  // },
})
