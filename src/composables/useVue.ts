import type { Ref } from 'vue'
import { ref, toValue } from 'vue'

const rootVue = ref()

async function waitForVue(selectors: string, matches: (component: any) => boolean, name: string) {
  return new Promise<any>((resolve, reject) => {
    const check = () => {
      const queue = Array.from(
        document.querySelectorAll(selectors),
        (element) => (element as any).__vue__,
      )
      const seen = new Set()
      for (let index = 0; index < queue.length; index++) {
        const component = queue[index]
        if (!component || seen.has(component)) continue
        seen.add(component)
        if (matches(component)) {
          clearInterval(interval)
          clearTimeout(timeout)
          resolve(component)
          return
        }
        queue.push(...(component.$children ?? []), component.$parent)
      }
    }
    const interval = setInterval(check, 100)
    const timeout = setTimeout(() => {
      clearInterval(interval)
      reject(new Error(`BOSS 页面尚未就绪：未找到${name}，请打开职位搜索页后重试`))
    }, 20000)
    check()
  })
}

export async function getRootVue(): Promise<any> {
  if (rootVue.value !== undefined) {
    return rootVue.value
  }

  rootVue.value = await waitForVue('#wrap', (component) => !!component.$router, '页面根组件')
  return rootVue.value
}

export function useHookVueData<T = any>(
  selectors: string,
  key: string,
  data: Ref<T>,
  update?: (val: T) => void,
) {
  return async () => {
    const jobVue = await waitForVue(
      selectors,
      (component) => key in component,
      `岗位数据（${key}）`,
    )

    data.value = jobVue[key]
    update?.(toValue(jobVue[key] as T))
    // eslint-disable-next-line no-restricted-properties
    const originalSet = jobVue.__lookupSetter__(key)
    // eslint-disable-next-line no-restricted-properties
    const originalGet = jobVue.__lookupGetter__(key)
    let current = jobVue[key]
    // eslint-disable-next-line accessor-pairs
    Object.defineProperty(jobVue, key, {
      configurable: true,
      enumerable: true,
      get: originalGet ?? (() => current),
      set(val: T) {
        if (originalSet) originalSet.call(this, val)
        else current = val
        data.value = val
        update?.(val)
      },
    })
  }
}

export function useHookVueFn(selectors: string, key: string | string[]) {
  return async () => {
    const keys = Array.isArray(key) ? key : [key]
    const jobVue = await waitForVue(
      selectors,
      (component) => keys.some((name) => typeof component[name] === 'function'),
      `岗位操作（${keys.join(' / ')}）`,
    )
    const name = keys.find((name) => typeof jobVue[name] === 'function')!
    return jobVue[name].bind(jobVue)
  }
}
