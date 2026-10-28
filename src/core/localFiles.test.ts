import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { localFiles, registerFile } = require('../../scripts/local-files.cjs') as {
  registerFile(file: string): { key: string; token: string }
  localFiles(options?: { openWith(target: string, reveal: boolean): Promise<void> }): (
    req: any,
    res: any,
    next: () => void,
  ) => Promise<void>
}

describe('document links', () => {
  it('识别 wiki 文件索引并拒绝危险协议', async () => {
    const modulePath = './links'
    const { findWikiLinks, linkKind } = await import(/* @vite-ignore */ modulePath)
    const text = '见 [[notes/a.md|旧稿]] 与 [[assets/data.csv]]，不是 `[[]]`'
    const links = findWikiLinks(text)
    expect(links.map((link: { target: string; label: string }) => [link.target, link.label])).toEqual([
      ['notes/a.md', '旧稿'],
      ['assets/data.csv', 'assets/data.csv'],
    ])
    expect(linkKind('https://example.com')).toBe('external')
    expect(linkKind('mailto:a@example.com')).toBe('external')
    expect(linkKind('file:///D:/notes/a.md')).toBe('file')
    expect(linkKind('D:\\notes\\a.md')).toBe('file')
    expect(linkKind('../notes/a.md')).toBe('file')
    expect(linkKind('javascript:alert(1)')).toBe('unsafe')
  })
})

describe('local system actions', () => {
  async function setup() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'writee-actions-test-'))
    const current = path.join(dir, '当前 文档.md')
    const target = path.join(dir, '目标 & 文件.txt')
    await fs.writeFile(current, '# 测试\n', 'utf8')
    await fs.writeFile(target, '内容', 'utf8')
    const capability = registerFile(current)
    const calls: Array<[string, boolean]> = []
    const middleware = localFiles({ openWith: async (value, reveal) => { calls.push([value, reveal]) } })
    const headers = {
      host: 'localhost:5173',
      origin: 'http://localhost:5173',
      'sec-fetch-site': 'same-origin',
      'x-writee-token': capability.token,
      'content-type': 'application/json',
    }
    const invoke = async (method: string, body?: unknown, changeHeaders: Record<string, string | undefined> = {}) => {
      const req = new Readable({ read() {} }) as any
      req.url = '/__local_file/' + capability.key
      req.method = method
      req.headers = { ...headers, ...changeHeaders }
      if (body !== undefined) req.push(JSON.stringify(body))
      req.push(null)
      const res = {
        statusCode: 200,
        body: '',
        setHeader() {},
        end(data?: string) { this.body = data ?? '' },
      }
      await middleware(req, res, () => { throw new Error('不应进入下一个中间件') })
      return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : {} }
    }
    return { dir, current, target, calls, invoke }
  }

  it('返回真实路径并通过注入边界打开相对文件、网页和所在文件夹', async () => {
    const ctx = await setup()
    try {
      const disk = await ctx.invoke('GET')
      expect(disk.body.path).toBe(await fs.realpath(ctx.current))
      expect((await ctx.invoke('POST', { action: 'open', target: './目标 & 文件.txt' })).status).toBe(200)
      expect((await ctx.invoke('POST', { action: 'open', target: 'https://example.com/?a=1&b=2' })).status).toBe(200)
      expect((await ctx.invoke('POST', { action: 'reveal' })).status).toBe(200)
      expect(ctx.calls).toEqual([
        [await fs.realpath(ctx.target), false],
        ['https://example.com/?a=1&b=2', false],
        [await fs.realpath(ctx.current), true],
      ])
    } finally {
      await fs.rm(ctx.dir, { recursive: true, force: true })
    }
  })

  it('拒绝无令牌、跨站、危险协议和缺失目标', async () => {
    const ctx = await setup()
    try {
      expect((await ctx.invoke('POST', { action: 'open', target: './目标 & 文件.txt' }, { 'x-writee-token': undefined })).status).toBe(403)
      expect((await ctx.invoke('POST', { action: 'open', target: './目标 & 文件.txt' }, { origin: 'https://example.com' })).status).toBe(403)
      expect((await ctx.invoke('POST', { action: 'open', target: 'javascript:alert(1)' })).status).toBe(400)
      expect((await ctx.invoke('POST', { action: 'open', target: './不存在.txt' })).status).toBe(400)
      expect(ctx.calls).toEqual([])
    } finally {
      await fs.rm(ctx.dir, { recursive: true, force: true })
    }
  })
})
