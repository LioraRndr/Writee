import type { LocalFileHandle } from './types'

export const isLocalFile = (h: object): h is LocalFileHandle => 'localKey' in h && 'token' in h
export const localSystemSupported = import.meta.env.DEV && typeof location !== 'undefined' && location.origin === 'http://localhost:5173'

const revisions = new Map<string, string>()

export async function localFileRequest(h: LocalFileHandle, text?: string) {
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

export async function launchedFile(): Promise<LocalFileHandle | null> {
  if (!localSystemSupported) return null
  const params = new URLSearchParams(location.hash.slice(1))
  const key = params.get('local-file')
  const token = params.get('token')
  if (!key || !token) return null
  if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{64}$/.test(token)) throw new Error('本地文件链接无效')
  const handle = await localFileRequest({ kind: 'file', name: '', localKey: key, token })
  return { kind: 'file', name: handle.name, path: handle.path, localKey: key, token }
}
