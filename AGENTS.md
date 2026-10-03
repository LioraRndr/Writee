# Writee 开发指南（接手必读）

本文件是给后续开发者 / Agent 的交接文档：需求、运行环境、架构、关键约定、测试方法、当前进度与待办。
**每次开发结束前请更新第 7 节“当前进度”和 [docs/DEVLOG.md](docs/DEVLOG.md)。**

用户文档见 [README.md](README.md)；结构分析文件格式见 [docs/structure-format.md](docs/structure-format.md)。

---

## 0. 动手前注意

- **项目目录是同步盘**：`/home/box/Writee-live` 是 rclone 挂载（远程 `writee:Writee`），同时同步到用户 Windows 电脑上的 `D:\R_Program\Writee`。用户和其他 Agent 窗口可能**同时**在改文件。
  - 修改前先看目标文件的修改时间 / 内容，不要覆盖别人刚做的改动（例如 `public/`、`scripts/`、`index.html` 的图标与启动脚本就是另一个会话加的）。
  - **绝不要在 box 上安装、删除或改动 `node_modules`**：它属于用户的 Windows 安装，删除会通过同步删掉用户本机的依赖（曾经发生过，见 DEVLOG）。
  - 写文件到挂载盘较慢（约 17ms/文件），大量小文件的操作不要放在挂载盘上做。
- 界面文案、代码注释用中文；保持现有代码风格（无分号、单引号、2 空格、prettier 风格）。
- 不引入 UI 组件库；颜色一律用 CSS 变量，新增变量要在 `src/styles/theme.css` 的五套主题里都补齐。

## 1. 需求摘要（来自用户）

1. 基础：Markdown 编辑器，实时编辑并渲染；打开本地 md 文件，直接修改原文件。
2. 标题跳转：按标题层级的侧边导航。
3. 卡片界面：按小标题切成嵌套卡片；兼容不同 AI 的标题层级习惯（按相对层级嵌套）；卡片调序、增删等体验流畅；卡片内 Markdown 依然清楚。
4. 注释：框选文字生成数字标签；注释可连接多个标签；侧边用连线显示对应关系，一目了然；增删查改体验好；注释不写入文件，但每篇文档有存档，注释可保存。
5. 一键复制注释：批量选择后复制成提示词，带文章上下文，简洁；若文章有**在本编辑器中手动**修改的部分，提示词要提醒：“我做了一些修改，注意不要替换成原来的文字，必要的话可以修改”。
6. 结构标签分析：以句子为单位（一句或多句），标准的分析文件格式，标签丰富（论证要素、写作手法等）；BYOK 接入 AI 一键分析标注。
7. AI 接入用**通用接口**：OpenAI 兼容、Anthropic 兼容，都能接第三方。
8. 视觉：优雅美观、便于阅读编辑、行距略宽松；字体思源宋体（CJK）+ Instrument Serif（西文）；配色预设。
9. 动效要做好；侧边栏可拖拽调宽。
10. 维护好项目文档，方便其他 Agent 无缝衔接。

## 2. 运行环境

### 用户本机（Windows）

```bash
npm install          # 依赖损坏时用 npm ci
npm run dev          # http://localhost:5173（必须用 localhost 或 https，才能直接读写本地文件）
```

- `scripts/launch-writee.vbs` → `launch-writee.cjs`：后台启动 Vite（`localhost:5173`，日志写到项目根目录的 `writee-server.log` / `writee-server-error.log`），通过 `public/writee-launch.json` 里的 id 确认服务是 Writee，然后用 Edge/Chrome 的 `--app` 窗口打开。`scripts/create-desktop-shortcut.ps1` 创建桌面快捷方式。这些脚本由另一个会话编写，改动前先确认。
- 日志文件已被 `.gitignore`（`*.log`）忽略。

### 远程开发机（Linux box，Agent 用）

挂载盘太慢且 `node_modules` 属于 Windows，所以 box 上的依赖与构建都在本地磁盘：

| 路径 | 作用 |
| --- | --- |
| `/home/box/Writee-live` | 源码（挂载盘，与 Windows 同步）——**只在这里改源码** |
| `/home/box/.writee-deps` | 本地工作副本：`node_modules`、vite 开发服务器、测试都在这里跑 |
| `/home/box/node_modules` | 指向 `.writee-deps/node_modules` 的软链接 |
| `/home/box/sync-writee.sh` | 把挂载盘上新修改的文件增量复制到 `.writee-deps`（按时间戳，跳过 node_modules / dist / 日志） |
| `/home/box/restart-vite.sh` | 在 `.writee-deps` 里（重新）启动 `vite --port 5173` |

常用流程：

```bash
/home/box/sync-writee.sh                       # 改完源码后同步（vite 会自动热更新）
cd /home/box/.writee-deps
./node_modules/.bin/tsc --noEmit -p .          # 类型检查
./node_modules/.bin/vitest run                 # 单元测试
CHROME_PATH=/usr/bin/google-chrome node e2e/run-all.mjs   # 端到端（需 vite 在跑）
./node_modules/.bin/vite build --outDir /tmp/writee-dist  # 构建检查（不要输出到挂载盘）
```

若上述脚本丢失，可按以下内容重建：

```bash
# /home/box/sync-writee.sh
SRC=/home/box/Writee-live; DST=/home/box/.writee-deps; STAMP=/home/box/.writee-sync-stamp
cd $SRC; [ -f $STAMP ] && NEWER="-newer $STAMP"; touch $STAMP.next
find . -path ./node_modules -prune -o -path ./dist -prune -o -name "*.log" -prune -o -name "*.partial" -prune \
  -o -type f $NEWER -print | while read f; do mkdir -p "$DST/$(dirname "$f")"; cp "$f" "$DST/$f"; echo "synced $f"; done
mv $STAMP.next $STAMP

# 依赖：在 /home/box/.writee-deps 放一份 package.json + package-lock.json 后 npm ci
```

注意：用 `pkill -f vite` 之类的命令可能把当前 shell 一起杀掉；用 `pgrep -f "[n]ode_modules/.bin/vite"` 取 pid 再 kill。

## 3. 技术栈与目录

React 19 + TypeScript + Vite 8 + CodeMirror 6 + zustand；IndexedDB（idb-keyval）；diff-match-patch；@anthropic-ai/sdk（按需动态加载）；字体 @fontsource/noto-serif-sc、@fontsource/instrument-serif。

```
src/
  core/        纯逻辑（无 React）
    types.ts         数据类型：DocData / Tag / Note / Unit / EditRange / DocArchive
    sections.ts      解析 ATX 标题 → 小节树（相对层级嵌套、唯一 H1 视为标题、锚点保持 id 稳定）
    cardOps.ts       移动文本块（自定义位置映射）、整体平移标题层级
    mapping.ts       位置映射 PosMapper、mapData、diff 生成变更集、记录手动修改
    sentences.ts     切句（结构分析与“修改过的句子”共用）
    notesPrompt.ts   复制给 AI 的提示词
    archive.ts       IndexedDB 存档与“最近的文档”索引
    fileAccess.ts    File System Access API 封装、下载、剪贴板
    derive.ts        标签编号、标签→注释索引、字数
    platform.ts      ⌘/Ctrl 快捷键文案
    core.test.ts     单元测试
  store/
    docStore.ts      文档状态（唯一事实来源）+ 全局撤销 + 卡片操作
    uiStore.ts       界面状态与设置（localStorage）、提示条
    session.ts       打开/新建/另存/自动保存/外部修改轮询/冲突处理
  editor/
    setup.ts         createEditor（主编辑器与卡片编辑器共用）、视图 ↔ store 同步、覆盖层计算、useSel
    livePreview.ts   实时预览装饰（隐藏标记、列表、引用、代码块、表格块级部件等）
    overlays.ts      注释标签、结构单元、修改痕迹的装饰
    registry.ts      已挂载视图登记、位置 → 页面坐标（posBox）、布局重算调度
    inline.ts        表格单元格的行内渲染
  components/
    Workspace.tsx    主布局、选区工具条、标签弹出框、委托事件
    MainEditor.tsx   编辑模式
    cards/           卡片视图（CardsView、CardEditor、dnd 树形拖拽、focus 推迟重排）
    rail/            注释栏（NotesRail）、结构栏（StructureRail）、对齐布局与连线（layout.ts）、TagPicker
    Outline.tsx      大纲（可拖拽排序）
    Resizer.tsx      侧栏宽度拖拽
    motion.ts        FLIP、进出场、平滑滚动
    hooks.ts         useWordCount、usePlacementClass
    reveal.ts        跳转到位置/小节（含平滑滚动）
    dialogs/         复制、设置、AI 设置、导入分析、格式说明、冲突
  analysis/
    taxonomy.ts      标签体系（8 类 90 个）
    prompt.ts        分析提示词（系统提示 + 按句编号的全文）
    ai.ts            通用 AI 接口（OpenAI 兼容 / Anthropic 兼容）、测试连接、模型列表
    run.ts           流式分析（JSON Lines 边收边标注）、startAnalysis
    format.ts        writee-structure/1 文件格式的导入导出、单元定位
  styles/            fonts / theme（五套配色）/ app / editor / cards / rail
e2e/                 端到端测试（playwright-core）
docs/                结构分析格式、开发日志
```

## 4. 数据流

```
CodeMirror 视图（主编辑器 1 个 / 每张卡片 1 个）
   │ 用户输入 → updateListener → 转成全文 ChangeSet（origin = 视图 id）
   ▼
useDoc.applyChanges / applyTransform / replaceText
   │ 1. 推入撤销历史（DocData 快照）
   │ 2. 生成新文本；mapData 用 PosMapper 映射 tags / units / edits / anchors
   │ 3. userEdit 时把变更区域记入 edits（手动修改）
   │ 4. 重建小节树（anchors 保持标题 id）
   │ 5. 发出 event { origin, touched, map }
   ▼
订阅者：其他视图按 origin/touched 决定是否同步文本（带 syncAnnot，不回写）
        覆盖层（标签、结构、修改痕迹）RAF 合并后重算
        session.ts：500ms 写存档、700ms 写回文件
        React 组件：大纲、注释栏、状态栏……
```

## 5. 关键约定与不变量（改代码前务必理解）

1. **全文是唯一事实来源**。所有位置数据都是全文字符偏移。任何文本变化必须走 `applyChanges` / `applyTransform`（自定义映射，如移动卡片）/ `replaceText`（diff 映射，如外部修改、整体替换）之一，不要直接改 `data.text`。
2. **DocData 不可变**：撤销历史保存的是对象引用，更新时创建新数组/对象，不要原地修改。
3. **视图同步协议**：视图自己的输入由 store 发回时（origin 相同）只更新 base；其他来源的变化用 `minimalChange` 同步并加 `syncAnnot`，以免回写。撤销/重做是 origin `history`。
4. **手动修改**只记录 `userEdit: true` 的变更（编辑器输入、卡片增删移动）。外部文件修改（origin `disk`）、撤销都不算。复制提示词时据此决定是否提醒 AI。
5. **卡片编辑器聚焦时推迟结构重排**：在卡片里键入 `## ` 会产生新小节，但要等失焦后才拆分卡片（`cards/focus.ts` + CardsView 的 `pending`），否则光标会被打断。
6. **标题 id 稳定**：`anchors` 随文本映射，`buildSections` 按位置匹配复用 id；卡片折叠状态按 id 存档。
7. **卡片的层级是相对的**：顶层卡片 = 去掉“唯一的 H1 标题”后最外层的小节；移动到新父级时整节标题按新兄弟的级别平移（`moveSection`）。
8. **浮层定位**（注释栏、结构栏、连线、选区工具条）全部使用 page 元素坐标；优先用 DOM 中的徽标（`[data-tag-badge]`、`[data-unit-start]`），视图虚拟化导致不在 DOM 时用 `registry.posBox` 估算。需要重排时调用 `registry.requestLayout()`（RAF 合并）。
9. **绝对定位的卡片**（注释、结构标签）用 `usePlacementClass`：未定位时 `visibility: hidden`。**隐藏元素无法获得焦点**，需要聚焦的逻辑要等定位之后（NoteCard 的 autoFocus 已处理）。
10. **AI 接口**：`ai.ts` 只有当 Base URL 是 `api.anthropic.com` 时才附加官方专属参数（自适应思考 + effort、`fallbacks: "default"` + beta 头、system 的 cache_control），并且只有带 beta 时才走 `client.beta.messages`；第三方只发送 `model / max_tokens / system / messages / stream` 加用户的“额外参数”。默认模型 `claude-opus-5-5`。
11. **存储**：注释、分析、修改痕迹、卡片折叠只存在 IndexedDB（`writee` 库），永不写入 md 文件；设置与 AI 配置在 localStorage（`writee.settings`、`writee.ai`、`writee.copyopts`）。
12. **动效**：统一用 `components/motion.ts`（FLIP、animateOut、smoothScroll），都要尊重 `prefers-reduced-motion`。CSS 进场动画用 `animation-fill-mode: backwards`，避免动画结束后残留 transform 覆盖其他样式。
13. **调试钩子**：开发模式下 `window.__writee = { useDoc, useUI, registry, session, buildNotesPrompt, importAnalysis, buildManualPrompt }`，e2e 依赖它，改名需同步修改 `e2e/`。

## 6. 测试

- 单元测试 `src/core/core.test.ts`（vitest）：标题解析与嵌套、id 稳定、移动文本块、层级平移、外部修改后的注释对齐、切句、提示词、分析导入的重新定位。
- 端到端 `e2e/`（`npm run e2e`，需先 `npm run dev`；环境变量 `WRITEE_URL`、`CHROME_PATH`、`SHOTS=目录` 保存截图）：
  - `annotate` 注释流程、徽标/圆点/连线数量、提示词与“手动修改”提醒
  - `cards` 卡片移动/升降级/撤销、鼠标拖拽排序与改层级、FLIP 与高度动画、删除退场动画与撤销
  - `file-sync` 用 OPFS 模拟本地文件：自动写回、外部修改载入且注释对齐、存档恢复
  - `ai-mock` 拦截请求模拟官方 Anthropic / 第三方 Anthropic 兼容 / OpenAI 兼容，校验请求格式与流式解析
  - `layout` 侧栏拖拽调宽与持久化、大纲收起动画、结构标注工具条
- 系统文件选择框、真实 API Key、输入法（IME）、Safari/Firefox 无法自动化，需人工验证。

## 7. 当前进度（更新于 2026-10-03）

**已完成**：第 1 节需求 1–10 全部实现并通过上述测试。

**GitHub 公开仓库（2026-10-03）**：[LioraRndr/Writee](https://github.com/LioraRndr/Writee)，默认分支 `main`，本机 `origin` 已配置并完成首次推送。上传前完成源码密钥检查、类型检查、10 项单元测试与生产构建；补齐 `Agent.md` 入口与环境配置 / 同步临时文件忽略规则。

**尚未验证 / 已知限制**
- 未用真实 API Key 实测任何服务商（只有模拟测试）；第三方服务的跨域策略各不相同，必要时用“本地代理转发”。
- 中文输入法组字、Safari/Firefox、触屏未测试。
- 图片只显示 http(s)/data 链接，相对路径的本地图片显示为占位（没有目录访问权限）。
- 超长文档（> 10 万字、数百个小节）在卡片模式下每张卡片一个编辑器，未做虚拟化。
- 存档只在本浏览器；清除站点数据会丢失注释，没有导出/导入存档功能。
- 写回文件失败时内容只保留在浏览器存档中（顶栏显示“保存失败 · 重试”）。

**可做的下一步（按价值排序，供参考）**
1. 存档导出 / 导入（注释与分析的备份、换电脑迁移）。
2. 注释栏“列表视图”与窄屏适配（目前窄屏只能收起侧栏）。
3. AI 根据注释直接给出修改稿并做差异对比、逐条接受。
4. 本地图片：申请目录权限后解析相对路径。
5. 卡片视图虚拟化，支持超长文档。
6. 结构分析分块（超长文章分段请求再合并）。

## 8. 常见坑

- File System Access API 只在安全上下文可用：`localhost` 或 `https`。用 IP 访问 `http://` 时会退化为存档模式。
- Windows 上 Vite 热更新可能读到 rclone 正在写入的 `*.partial` 临时文件，出现一次性报错，保存完成后会恢复。
- CodeMirror 开启自动换行后，End 键移动到“视觉行”末尾而非段落末尾（写测试时注意）。
- `npm run build` 使用 `tsc --noEmit` 再 `vite build`；box 上构建请输出到 `/tmp`，不要写进挂载盘。
