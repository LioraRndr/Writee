// 运行全部端到端测试：node e2e/run-all.mjs [名称过滤]
// 前提：npm run dev 已在运行（默认 http://localhost:5173/）
import { launch } from './helpers.mjs'

const specs = ['annotate', 'cards', 'file-sync', 'ai-mock', 'layout']
const filter = process.argv[2]
let failed = 0

for (const file of specs) {
  if (filter && !file.includes(filter)) continue
  const mod = await import(`./${file}.mjs`)
  const ctx = await launch()
  const t0 = Date.now()
  try {
    await mod.default(ctx)
    if (ctx.errors.length) throw new Error('页面报错：\n  ' + ctx.errors.join('\n  '))
    console.log(`✓ ${mod.name}（${Date.now() - t0}ms）`)
  } catch (e) {
    failed++
    console.log(`✗ ${mod.name}\n  ${String(e.message ?? e).replace(/\n/g, '\n  ')}`)
  } finally {
    await ctx.browser.close()
  }
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
