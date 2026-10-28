# Writee 编辑与本机工作流增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task inline. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents unless the user separately authorizes them.

**Goal:** 在不替换编辑器架构的前提下交付 LaTeX、完整表格工具、自然卡片动画、本机文件/链接操作与窄屏布局。

**Architecture:** 纯逻辑放在 `src/core`，CodeMirror 只负责装饰和交互，所有文本修改仍经全文 store。系统能力只扩展已有限权 localhost 服务；UI 使用现有 Menu、主题变量和 motion 工具。

**Tech Stack:** React 19、TypeScript、CodeMirror 6、zustand、KaTeX、Vitest、playwright-core、Node 本机中间件。

---

### Task 1: 公式扫描与 KaTeX 装饰

**Files:**
- Create: `src/core/math.ts`
- Create: `src/editor/MathWidget.ts`
- Modify: `src/editor/livePreview.ts`
- Modify: `src/styles/editor.css`
- Modify: `package.json`
- Test: `src/core/core.test.ts`

- [ ] **Step 1: 写公式范围失败测试**

新增断言：`findMathRanges` 识别四种定界符，跳过 `\$`、代码范围和未闭合公式，且 `display` 只对 `$$` / `\[` 为真。

- [ ] **Step 2: 运行并确认 RED**

Run: `npm test -- --run src/core/core.test.ts`
Expected: 因 `findMathRanges` 尚不存在而失败，而不是测试语法错误。

- [ ] **Step 3: 实现扫描与 Widget**

核心返回类型固定为：

```ts
export interface MathRange { from: number; to: number; source: string; display: boolean }
export function findMathRanges(text: string, excluded?: Array<{ from: number; to: number }>): MathRange[]
```

Widget 调用 `katex.renderToString(source, { displayMode: display, throwOnError: false, trust: false })`；装饰范围被光标接触时保留源码。

- [ ] **Step 4: 运行公式单测与类型检查**

Run: `npm test -- --run src/core/core.test.ts && npm run typecheck`
Expected: 公式测试通过，TypeScript 无错误。

### Task 2: 表格模型与完整交互

**Files:**
- Create: `src/core/table.ts`
- Create: `src/editor/TableWidget.ts`
- Modify: `src/editor/livePreview.ts`
- Modify: `src/editor/inline.ts`
- Modify: `src/styles/editor.css`
- Test: `src/core/core.test.ts`
- Create: `e2e/editing.mjs`

- [ ] **Step 1: 写表格模型失败测试**

覆盖转义竖线、对齐往返、单元格更新、行列增删移动、TSV 引号/CRLF、多格粘贴扩展。接口固定为：

```ts
parseTable(source: string): TableModel
serializeTable(model: TableModel): string
updateCell(model: TableModel, row: number, col: number, value: string): TableModel
pasteGrid(model: TableModel, row: number, col: number, grid: string[][]): TableModel
```

- [ ] **Step 2: 运行并确认 RED**

Run: `npm test -- --run src/core/core.test.ts`
Expected: 因表格模块不存在或行为未实现而失败。

- [ ] **Step 3: 实现模型，再写交互失败 E2E**

模型全部不可变；Widget 内所有修改使用：

```ts
view.dispatch({ changes: diffChanges(source, serializeTable(next)), userEvent: 'input.table' })
```

E2E 先验证单击编辑、Esc、Tab、方向键、撤销、粘贴和拖放，再运行确认当前只读表格失败。

- [ ] **Step 4: 实现 Widget 并验证 GREEN**

Run: `node e2e/run-all.mjs editing`
Expected: 编辑和卡片两种模式均通过，无页面异常。

### Task 3: 嵌套卡片动画

**Files:**
- Modify: `src/components/cards/CardsView.tsx`
- Modify: `src/components/motion.ts`
- Modify: `e2e/cards.mjs`

- [ ] **Step 1: 写三级展开失败 E2E**

记录切换卡片与祖先的 height 动画；断言同族动画时长/缓动一致，新子卡关键帧不含 scale，并检查快速连续切换后 overflow 不残留。

- [ ] **Step 2: 运行并确认 RED**

Run: `node e2e/run-all.mjs cards`
Expected: 当前实现只有目标卡片有高度动画且新子卡包含 scale。

- [ ] **Step 3: 同步祖先高度并移除缩放入场**

`heightIds` 为目标及其 `data-card` 祖先的并集；所有动画继续使用 `EASE`，完成和取消都恢复样式，按钮写 `aria-expanded`。

- [ ] **Step 4: 验证动画与既有卡片操作**

Run: `node e2e/run-all.mjs cards`
Expected: 新测试及拖拽、删除、撤销全部通过。

### Task 4: 限权系统操作、文件菜单与链接

**Files:**
- Create: `src/core/links.ts`
- Create: `src/core/localFiles.test.ts`
- Modify: `scripts/local-files.cjs`
- Modify: `src/core/localFile.ts`
- Modify: `src/core/types.ts`
- Modify: `src/store/session.ts`
- Modify: `src/components/TopBar.tsx`
- Modify: `src/components/Workspace.tsx`
- Modify: `src/editor/livePreview.ts`
- Modify: `src/editor/inline.ts`
- Modify: `e2e/local-file.mjs`

- [ ] **Step 1: 写链接与本机中间件失败测试**

链接测试覆盖安全协议、wiki 目标和相对路径。中间件测试通过 `localFiles({ openWith: fake })` 注入 OS 边界，验证无令牌/跨站拒绝、目标存在检查、无 shell 参数和 reveal/open 路由。

- [ ] **Step 2: 运行并确认 RED**

Run: `npm test -- --run src/core/localFiles.test.ts`
Expected: 当前接口不支持 POST action 或目标解析。

- [ ] **Step 3: 实现本机 action 与前端入口**

POST body 只接受 `{ action: 'open'|'reveal', target?: string }`。本机 spawn 使用参数数组且 `shell:false`；前端新增：

```ts
localFileAction(handle, action, target?)
localFilePath(handle): Promise<string>
openDocumentLink(target): Promise<void>
```

文件菜单的不可用项必须 disabled；链接只有 Ctrl/Cmd+点击调用打开。

- [ ] **Step 4: 验证安全和真实文件回归**

Run: `npm test -- --run src/core/localFiles.test.ts && node e2e/run-all.mjs local-file`
Expected: 新能力通过且原有 UTF-8、CRLF、冲突、存档测试不回归。

### Task 5: 顶栏与正文窄屏布局

**Files:**
- Modify: `src/components/TopBar.tsx`
- Modify: `src/components/hooks.ts`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/styles/app.css`
- Modify: `src/styles/editor.css`
- Modify: `e2e/layout.mjs`

- [ ] **Step 1: 写 320/480/720/900px 失败 E2E**

断言 `document.documentElement.scrollWidth <= innerWidth`，顶栏控件矩形不相交，主要按钮可见，正文有可用宽度；侧栏开启时正文不被压缩成逐字换行。

- [ ] **Step 2: 运行并确认 RED**

Run: `node e2e/run-all.mjs layout`
Expected: 复现顶栏覆盖和正文过窄。

- [ ] **Step 3: 实现分组换行、紧凑菜单和覆盖侧栏**

用 `matchMedia` 只切换紧凑操作的组件结构；CSS 使用 `minmax(0, …)`、`min-width:0`、容器/视口断点，不用 `overflow:hidden` 掩盖顶栏问题。

- [ ] **Step 4: 验证所有宽度及桌面回归**

Run: `node e2e/run-all.mjs layout`
Expected: 所有目标宽度与既有拖拽、主题测试通过，截图无重叠。

### Task 6: 全量验证与交接

**Files:**
- Modify: `e2e/run-all.mjs`
- Modify: `AGENTS.md`
- Modify: `docs/DEVLOG.md`
- Modify: `README.md`

- [ ] **Step 1: 注册新增 E2E 并执行全量验证**

Run: `npm run typecheck && npm test && npm run e2e && npm run build`
Expected: 全部命令退出码 0；构建包含 KaTeX CSS/字体资源。

- [ ] **Step 2: 检查交付形态**

用内置浏览器实际检查公式、表格操作、文件菜单、三级展开与窄屏；检查 console 无错误，五套主题下公式/表格可读。

- [ ] **Step 3: 更新文档并复核 diff**

记录新能力、本机降级边界、测试证据和未人工验证项。Run: `git diff --check && git status --short`
Expected: 无空白错误；只包含本任务与此前已有改动，不提交、不推送、不部署。
