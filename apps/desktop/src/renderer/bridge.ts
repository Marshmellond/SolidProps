import type { Bridge } from './types'

const nativeBridge = (window as unknown as { cadweave?: Bridge }).cadweave
export async function request<T>(method: string, params?: unknown): Promise<T> {
  if (!nativeBridge) {
    throw new Error('当前页面没有桌面桥接，请使用 SolidProps 桌面应用。')
  }
  return (await nativeBridge.request(method, params)) as T
}
