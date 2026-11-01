import type { FileHandle, LocalFileHandle } from './types'

export const isLocalFile = (h: object): h is LocalFileHandle => 'localKey' in h && 'token' in h
export const desktopSupported = typeof location !== 'undefined' && location.origin === 'http://127.0.0.1:5183'
export const localSystemSupported = desktopSupported || (import.meta.env.DEV && typeof location !== 'undefined' && location.origin === 'http://localhost:5173')

export function imageAssetUrl(src: string, handle: FileHandle | null | undefined) {
  if (/^(https?:|data:|blob:)/.test(src)) return src
  if (!handle || !isLocalFile(handle)) return null
  return `/__local_asset/${handle.localKey}?token=${encodeURIComponent(handle.token)}&path=${encodeURIComponent(src)}`
}

const revisions = new Map<string, string>()

export async function localFileRequest(h: LocalFileHandle, text?: string) {
  if (text !== undefined && !revisions.has(h.localKey)) await localFileRequest(h)
  const response = await fetch('/__local_file/' + h.localKey, {
    method: text === undefined ? 'GET' : 'PUT',
    headers: { 'X-Writee-Token': h.token, 'Content-Type': 'application/json' },
    body: text === undefined ? undefined : JSON.stringify({ text, revision: revisions.get(h.localKey) }),
    cache: 'no-store',
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? '本地文件访问失败，请重新双击打开')
  revisions.set(h.localKey, data.revision)
  return data as { name: string; path: string; text: string; modified: number; revision: string }
}

export async function localFilePath(h: LocalFileHandle) {
  if (!localSystemSupported) throw new Error('真实路径仅在本机 Writee 启动器中可用')
  const filePath = h.path ?? (await localFileRequest(h)).path
  if (typeof filePath !== 'string' || !filePath) throw new Error('本机服务未返回文件路径，请重启 Writee 后重试')
  return filePath
}

export async function localFileAction(h: LocalFileHandle, action: 'open' | 'reveal', target?: string) {
  if (!localSystemSupported) throw new Error('系统操作仅在本机 Writee 启动器中可用')
  const response = await fetch('/__local_file/' + h.localKey, {
    method: 'POST',
    headers: { 'X-Writee-Token': h.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(action === 'open' ? { action, target } : { action }),
    cache: 'no-store',
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? '系统操作失败')
}

export async function desktopFileDialog(action: 'open' | 'save', suggestedName?: string): Promise<LocalFileHandle | null> {
  if (!desktopSupported) return null
  const response = await fetch('/__desktop_dialog/', {
    method: 'POST',
    headers: { 'X-Writee-Dialog': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, suggestedName }),
    cache: 'no-store',
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? '文件对话框失败')
  return data.handle as LocalFileHandle | null
}

export interface LocalLaunchRequest {
  requestId: string
  key: string
  token: string
}

export async function takeLaunchedFile(): Promise<LocalLaunchRequest | null> {
  if (!localSystemSupported) return null
  const response = await fetch('/__local_launch/', {
    headers: { 'X-Writee-Launch': '1' },
    cache: 'no-store',
  })
  if (!response.headers.get('content-type')?.includes('application/json')) return null
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? '本地启动请求读取失败')
  return data as LocalLaunchRequest | null
}

export async function confirmLaunchedFile(request: LocalLaunchRequest) {
  const response = await fetch('/__local_launch/', {
    method: 'POST',
    headers: { 'X-Writee-Launch': '1', 'X-Writee-Token': request.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    cache: 'no-store',
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? '本地启动请求确认失败')
}

export async function launchedFile(request?: LocalLaunchRequest): Promise<LocalFileHandle | null> {
  if (!localSystemSupported) return null
  const params = new URLSearchParams(location.hash.slice(1))
  const key = request?.key ?? params.get('local-file')
  const token = request?.token ?? params.get('token')
  if (!key || !token) return null
  if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{64}$/.test(token)) throw new Error('本地文件链接无效')
  const handle = await localFileRequest({ kind: 'file', name: '', localKey: key, token })
  return { kind: 'file', name: handle.name, path: handle.path, localKey: key, token }
}
