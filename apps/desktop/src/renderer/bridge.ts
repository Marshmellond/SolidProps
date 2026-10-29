import type { Bridge } from './types'

const nativeBridge = (window as unknown as { cadweave?: Bridge }).cadweave
export async function request<T>(method: string, params?: unknown): Promise<T> {
  if (!nativeBridge) {
    throw new Error('当前页面没有桌面 CAD 桥接，请使用 CadWeave 桌面应用。')
  }
  return (await nativeBridge.request(method, params)) as T
}

export function exportText(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
