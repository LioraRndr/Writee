import type { FileHandle } from './types'
import { isLocalFile, localFileRequest } from './localFile'

export const fsaSupported = typeof window !== 'undefined' && 'showOpenFilePicker' in window

const MD_TYPES: FilePickerAcceptType[] = [
  { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.txt'] } },
]

export async function pickMarkdownFile(): Promise<FileSystemFileHandle | null> {
  try {
    const [h] = await window.showOpenFilePicker({ types: MD_TYPES, multiple: false, excludeAcceptAllOption: false })
    return h ?? null
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null
    throw e
  }
}

export async function pickSaveFile(suggestedName: string): Promise<FileSystemFileHandle | null> {
  try {
    return await window.showSaveFilePicker({ suggestedName, types: MD_TYPES })
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null
    throw e
  }
}

export async function hasPermission(h: FileSystemHandle | FileHandle, mode: 'read' | 'readwrite' = 'readwrite') {
  if (isLocalFile(h)) return true
  try {
    return (await h.queryPermission({ mode })) === 'granted'
  } catch {
    return false
  }
}

/** 请求权限（需要在用户手势中调用） */
export async function requestPermission(h: FileSystemHandle | FileHandle, mode: 'read' | 'readwrite' = 'readwrite') {
  if (isLocalFile(h)) return true
  try {
    if ((await h.queryPermission({ mode })) === 'granted') return true
    return (await h.requestPermission({ mode })) === 'granted'
  } catch {
    return false
  }
}

export async function readHandle(h: FileHandle): Promise<{ text: string; modified: number }> {
  if (isLocalFile(h)) {
    const disk = await localFileRequest(h)
    return { text: normalizeNewlines(disk.text), modified: disk.modified }
  }
  const f = await h.getFile()
  return { text: normalizeNewlines(await f.text()), modified: f.lastModified }
}

export async function statHandle(h: FileHandle): Promise<number> {
  if (isLocalFile(h)) return (await localFileRequest(h)).modified
  const f = await h.getFile()
  return f.lastModified
}

export async function writeHandle(h: FileHandle, text: string): Promise<number> {
  if (isLocalFile(h)) return (await localFileRequest(h, text)).modified
  const w = await h.createWritable()
  await w.write(text)
  await w.close()
  return statHandle(h)
}

export function normalizeNewlines(s: string) {
  return s.replace(/\r\n?/g, '\n').replace(/^﻿/, '')
}

export function downloadText(name: string, text: string, type = 'text/markdown') {
  const blob = new Blob([text], { type: type + ';charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(a.href)
    a.remove()
  }, 1000)
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

export function readFileInput(accept = '.md,.markdown,.txt'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}
