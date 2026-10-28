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

- `scripts/launch-writee.vbs` → `launch-writee.cjs`：后台启动 Vite（`localhost:5173`，日志写到项目根目录的 `writee-server.log` / `writee-server-error.log`），通过 `public/writee-launch.json` 里的 id 确认服务是 Writee，然后优先用 Chrome 的 `--app` 窗口打开（未安装时回退到 Edge）。`scripts/create-desktop-shortcut.ps1` 创建桌面快捷方式。这些脚本由另一个会话编写，改动前先确认。
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
    math.ts          LaTeX 定界符扫描、代码/转义排除
    table.ts         表格不可变模型、Markdown/TSV 解析与序列化、行列操作
    links.ts         链接协议分类、wiki 文件索引扫描
    localFile.ts     本机文件请求、真实路径与限权系统动作客户端
    sentences.ts     切句（结构分析与“修改过的句子”共用）
    notesPrompt.ts   复制给 AI 的提示词
    archive.ts       IndexedDB 存档与“最近的文档”索引
    fileAccess.ts    File System Access API 封装、下载、剪贴板
    derive.ts        标签编号、标签→注释索引、字数
    platform.ts      ⌘/Ctrl 快捷键文案
    core.test.ts     核心逻辑单元测试
    localFiles.test.ts 链接与本机系统动作测试（注入 OS 边界）
  store/
    docStore.ts      文档状态（唯一事实来源）+ 全局撤销 + 卡片操作
    uiStore.ts       界面状态与设置（localStorage）、提示条
    session.ts       多标签页（停放/切回/关闭/串行队列）、打开/新建/另存/自动保存/外部修改轮询/冲突处理、链接打开
  editor/
    setup.ts         createEditor（主编辑器与卡片编辑器共用）、视图 ↔ store 同步、覆盖层计算、useSel
    livePreview.ts   实时预览装饰（隐藏标记、公式、链接、表格、列表、引用、代码块等）
    MathWidget.ts    KaTeX 行内/块级公式部件
    TableWidget.ts   渲染表格：控制器挂在 DOM 上原地更新（updateDOM），单元格编辑、拖选、右键/行列菜单、拖放与剪贴板
    LinkWidget.ts    wiki 文件索引渲染与点击回源码
    overlays.ts      注释标签、结构单元、修改痕迹的装饰
    registry.ts      已挂载视图登记、位置 → 页面坐标（posBox）、布局重算调度
    inline.ts        表格单元格的行内 Markdown / 公式 / 链接渲染
  components/
    Workspace.tsx    主布局、左侧栏“大纲/标签页”切换、选区工具条、标签弹出框、委托事件
    TabStrip.tsx     标签栏（顶部横排 / 左侧栏竖排）：切换、关闭、拖动排序、右键菜单
    MainEditor.tsx   编辑模式
    cards/           卡片视图（CardsView、CardEditor、dnd 树形拖拽、focus 推迟重排、fold 折叠交叉过渡）
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

多标签页：useDoc 始终只装“当前标签页”的文档。切换时 `session.park()` 先写回文件、写存档，再把 `meta / data / past / future / 文件状态 / 磁盘基线 sess / 冲突 / 模式与折叠 / 滚动位置` 停放到内存 `parked`；切回时 `unpark()` 用 `useDoc.restore()` 原样恢复（撤销历史不丢），随后立即 `checkDisk()`。标签页列表（id + 名称）存在 localStorage `writee.tabs`，刷新后只恢复列表，点选时再从存档载入。

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
11. **存储**：注释、分析、修改痕迹、卡片折叠只存在 IndexedDB（`writee` 库），永不写入 md 文件；设置与 AI 配置在 localStorage（`writee.settings`、`writee.ai`、`writee.copyopts`），打开的标签页列表在 `writee.tabs`。
12. **动效**：统一用 `components/motion.ts`（FLIP、animateOut、smoothScroll），都要尊重 `prefers-reduced-motion`。CSS 进场动画用 `animation-fill-mode: backwards`，避免动画结束后残留 transform 覆盖其他样式。`CardEditor` 必须在 layout effect 中挂载，父级 FLIP 只能读取真实编辑器高度；E2E 要求动画终点与最终自然高度误差不超过 2px，不能把空容器高度当成终点。折叠标题与展开标题必须共享字号、行高、padding、`font-feature-settings` 与东亚字体变体。折叠/展开由 `cards/fold.ts` 处理：在 `collapsed` 变化的同步监听里（React 重渲染前）把即将移除的内容（展开前的摘要按钮 / 收起前的编辑器与子卡片）克隆成 `.card-fold-ghost`，去掉全部 `data-*`、焦点与光标层，标题在克隆里隐藏；新内容的淡入由卡片上的 `data-fold` 属性驱动的 CSS（编辑器首行即标题不参与）。**标题在任何一侧都不能模糊或淡入**。`playFlip` 在折叠时按最大高度变化量统一时长（240–460ms）与曲线 `FOLD_EASE`，且必须逐个读取元素位置（前面已开始的高度动画会推动后面的元素，批量读取会导致位移翻倍）。减少动态效果时不创建幽灵层。
13. **调试钩子**：开发模式下 `window.__writee = { useDoc, useUI, registry, session, buildNotesPrompt, importAnalysis, buildManualPrompt }`，e2e 依赖它，改名需同步修改 `e2e/`。
14. **表格写回**：`core/table.ts` 统一解析与序列化；Widget 产生差异后必须加表格起点 `from`，并交给当前视图构造 ChangeSet，不能把表格局部长度的 ChangeSet 直接 dispatch 给整篇文档。`TableController` 挂在部件 DOM 上，`updateDOM` 原地更新（同一张表：起点或源码之一相同），提交后的焦点由 `focusRequests` 交接；重建表格时旧编辑框被移除会触发 focusout，必须用 `rendering` 标记忽略；失焦提交带 `focus: false`，不能把焦点抢回表格。编辑框覆盖在单元格上、隐藏的 `.cm-table-sizer` 撑开尺寸，保证进入编辑时列宽不变；每列按内容设置最小宽度（封顶 10em）。部件自己处理的按键要 `stopPropagation`，全局 ⌘Z 也会跳过 `defaultPrevented` 的事件，避免撤销两次。撤销/重做把光标送回变化处时，若落在渲染表格内则改为选中单元格（`renderedTableAt` + `focusTableAt`），上下方向键从正文进入表格同理，表格只在主动“编辑源码”或在源码里输入时才显示 Markdown。
15. **本机系统动作**：`open/reveal` 复用现有限权令牌与 localhost POST 通道，不开放任意网页调用；相对路径以当前 Markdown 目录解析，OS 调用禁止 shell 拼接。网页版没有真实绝对路径时不伪造。
16. **多标签页**：打开、切换、关闭都经过 `session.ts` 的 `serial()` 队列；内部互相调用用 `*Impl` 版本，避免排队等自己。新文档一律走 `present(id, install)`：已在前台只检查磁盘，在后台则切回，否则停放当前文档后载入并插到当前标签页之后。后台标签页不轮询磁盘，切回时检查。恢复快照期间 `quiet` 为真，跳过自动写回/存档调度。工作目录迁移会同步更新后台快照的 `sess.location`。Workspace 按 `meta.id` 重新挂载，滚动位置用 `pendingScrollFor(id)` 读取、应用后再清除（开发模式 StrictMode 会挂载两次）。
17. **全角标点**：正文不得启用 `font-variant-east-asian: proportional-width`（pwid），并显式写 `'pwid' 0`。本机装有思源宋体时 pwid 会把 `，`、`（`、`“` 收窄成与半角相同的宽度，全角/半角逗号无法区分。

## 6. 测试

- 单元测试 `src/core/core.test.ts` 与 `src/core/localFiles.test.ts`（vitest）：标题、映射、切句、提示词、分析导入、公式范围、表格/TSV、链接分类、本机路径与系统动作安全；OS 边界注入，不实际弹出外部程序。
- 端到端 `e2e/`（`npm run e2e`，需先 `npm run dev`；环境变量 `WRITEE_URL`、`CHROME_PATH`、`SHOTS=目录` 保存截图）：
  - `annotate` 注释流程、徽标/圆点/连线数量、提示词与“手动修改”提醒
  - `cards` 卡片移动/升降级/撤销、拖拽、三级展开祖先同步与快速切换、标题同宽同位、摘要模糊过渡、删除退场
  - `file-sync` 用 OPFS 模拟本地文件：自动写回、外部修改载入且注释对齐、存档恢复
  - `workspace` 工作目录身份、文件替换、同名隔离与旧笔记恢复
  - `ai-mock` 拦截请求模拟官方 Anthropic / 第三方 Anthropic 兼容 / OpenAI 兼容，校验请求格式与流式解析
  - `layout` 侧栏拖拽、结构标注、主题光标、320/480/720/900px 顶栏与侧栏互斥
  - `local-file` 真实本机文件读写、编码/冲突/存档、文件菜单与链接动作（动作请求拦截）
  - `editing` 两种模式的公式、表格编辑/撤销/注释定位/粘贴/拖放/真实剪贴板；表格进入编辑列宽不变、点击落点、Enter/Tab 流程、失焦不抢焦点、右键与行列菜单、拖选、添加行、方向键进出表格与撤销后保持渲染；全角标点不启用 pwid
  - `tabs` 多标签页：新开/切换保留正文、撤销历史、模式与滚动位置，文件型标签页切走前写回、切回载入外部修改、关闭前写回，Alt+数字、拖动排序、右键关闭其他、“+”回文档列表、左侧栏与大纲切换、刷新后恢复列表
- 系统文件选择框、真实 API Key、输入法（IME）、Safari/Firefox、实际外部程序打开无法自动化，需人工验证。
- 云端容器里的 headless Chromium（Playwright 1243 版）对“从 IndexedDB 取回的 OPFS 句柄”调用任何方法（`isSameEntry`、`resolve`、`queryPermission`……）都会让页面崩溃，因此 `file-sync`、`workspace` 两组在该环境必然失败（改动前同样如此）；需在本机 Chrome 上跑。`tabs` 里的文件型标签页只打开一个 OPFS 文件、不触发取回句柄，可以在两处都运行。

## 7. 当前进度（更新于 2026-10-28）

**多标签页、表格交互、卡片折叠动效与全角标点（2026-10-28，云端会话）**：新增多标签页：每篇文档一个标签页，切换时先写回文件与存档再停放内存快照，切回原样恢复正文、撤销历史、模式、折叠与滚动位置并立即检查外部修改；关闭当前标签页切到相邻页，`+` 回到文档列表；支持中键/×关闭、拖动排序、右键“关闭其他/右侧”、Alt+1…9；标签栏默认在顶部，可移到左侧栏与大纲用开关切换（设置里也可改），刷新后恢复列表、点选再载入。表格部件重写为挂在 DOM 上的控制器并用 `updateDOM` 原地更新：进入编辑列宽不变、点击处落光标、Enter 编辑下一行、Tab 到末格新增行、方向键跨格、拖选范围、右键与行列把手菜单、悬停添加行列、浮动工具条、失焦提交不抢焦点、方向键进出表格、撤销后保持渲染；修复两处“撤销两次”（部件按键冒泡到全局、编辑器处理后焦点移入表格）。卡片折叠/展开改为克隆旧内容原位淡出、新内容模糊淡入，收起时不再先变成空框，标题两侧都不参与动画；高度与下方卡片同一曲线、按变化量定时长，并修复逐帧读取位置的位移翻倍问题。全角标点：去掉正文 `proportional-width`（本机思源宋体下 `，` 被收窄到 7px，与 `,` 无法区分），实测恢复为 18.5px。验证：类型检查、19 项单元测试、生产构建通过；新增 `tabs` E2E，`cards`、`editing` 扩充，9 组中 7 组在云端容器通过，`file-sync`、`workspace` 因容器 Chromium 对 IndexedDB 取回的 OPFS 句柄崩溃而无法运行（改动前同样失败，需在本机 Chrome 复跑）。逐帧截图检查了两种方向的折叠、表格各状态、标签栏顶部/左侧、360/720px 与墨夜主题。本次提交并推送到分支 `claude/adoring-thompson-ml3vu0`，未部署线上。

**公式、表格、卡片动效、本机链接与窄屏（2026-10-27）**：新增 KaTeX 行内/块级公式（四种定界符、代码与转义排除、点击回源码）；表格改为直接编辑单元格，支持键盘与范围选择、行列增删/拖放/对齐、TSV 网格复制粘贴，所有写回经同一全文事务并对齐注释。三级卡片展开同步目标与祖先高度，新子卡不再缩放，快速切换不残留裁剪；复查发现空编辑器测高后，已改为 `CardEditor` 在 layout effect 先挂载再执行 FLIP，动画终点与最终自然高度误差 ≤ 2px；折叠/展开标题统一字体特性与间距，中文双引号同宽同位，摘要使用不占布局的模糊交叉过渡。文件菜单新增另存为、复制真实路径、文件夹显示与系统默认打开；Markdown/裸 URL/表格/wiki 链接 Ctrl+点击打开，本机经限权 POST 接口调用系统默认程序，网页版明确降级。顶栏小屏分行并收纳次要操作，侧栏覆盖且互斥，进入窄屏先展示正文。19 项单元测试、8 组 Chrome E2E、类型检查、生产构建通过；320/480/720/900px 与稳定截图已检查。OS 打开边界用注入测试验证，未在自动化中实际弹出外部应用；本次按用户要求提交并推送 GitHub，未部署线上。

**Windows 候选列表修正（同日）**：初次直接注册 WScript 打开命令时，用户反馈候选列表不显示 Writee。已新增 `scripts/WriteeLauncher.cs`，注册脚本使用 Windows .NET Framework 编译器生成带 Writee 名称与图标的 `scripts/bin/Writee.exe`，以独立 EXE 注册 ProgID、Applications/SupportedTypes 与 App Paths。生成目录已忽略；无控制台窗口，转发参数给原 Node 启动器。Windows Shell 的 `SHAssocEnumHandlers` 实际枚举已返回 `Writee | D:\R_Program\Writee\scripts\bin\Writee.exe`，可从列表选择或手动浏览此 EXE。默认选择仍由用户确认。

**Windows Markdown 打开方式（2026-10-16）**：Node / VBS 启动器接收文件参数，Chrome 应用窗口自动打开指定文件并沿用原有自动写回、外部修改检测、冲突与注释存档流程。`scripts/register-markdown.ps1 -OpenSettings` 向当前用户注册 Writee 的 `.md` / `.markdown` / `.mdown` 打开方式并打开系统设置；不修改受保护的 UserChoice，最终默认选择由用户在 Windows 界面确认。`scripts/local-files.cjs` 提供仅 localhost:5173 开发服务启用的能力令牌文件通道，令牌存于用户临时目录，不写入项目或同步盘。仅接收严格 UTF-8，保持 BOM 和纯 CRLF/LF，拒绝未知编码、过期版本、跨站访问及缺失文件重建；按绝对路径恢复注释，文件替换不影响身份。本入口与浏览器原有 FSA 授权入口的存档身份独立，不自动合并旧存档；临时授权被清理后重新双击即可恢复连接。10 项单元测试、7 组 Chrome E2E、类型检查与生产构建通过；真实本机文件测试覆盖中文/空格/特殊字符路径、原文件写回、编码保持、替换、注释恢复与冲突。已在本机注册候选应用，默认 `.md` 最后核验仍为 Typora，等待系统界面确认；本次按用户要求提交并推送 GitHub，未部署线上。

**注释清理与夜色光标（2026-10-06）**：复制弹窗新增“复制后清除所选注释”，默认关闭并通过原 `writee.copyopts` 记住选择；仅在剪贴板成功写入后删除所选注释，失败保留并提示重试，支持撤销清除。单条、批量及复制后删除共用同一 store 逻辑，同时清理对应的无关联标签，保留其他注释共用的标签与独立标签，一次撤销恢复注释与标签。修正 CodeMirror 默认黑色原生光标覆盖主题 CSS 的问题，主编辑器与卡片编辑器均使用主题强调色。类型检查、10 项单元测试、6 组 Chrome E2E 和生产构建通过；新增 E2E 覆盖真实剪贴板、复制失败、撤销及五套主题的两种编辑模式，复制弹窗与夜色截图检查通过。本次按用户要求提交并推送 GitHub；未部署线上。

**线上部署（2026-10-03）**：https://writee.sakisaki.top/ 已上线，固定提交 `4925a1c4a96c0921079bb8909bd3b13ea4f264d1`，17 项公网和 5 项隔离 Chrome 生产验收通过。运维事实以服务器维护目录 `projects/writee/STATE.md` 为准。

**稳定文件身份（2026-10-04）**：首页及文件菜单新增“工作目录”。授权目录后按目录 ID + 相对路径恢复存档，轮询和写回均从目录重新取得句柄，支持 Agent 反复替换同一路径的文件。现有有效句柄自动迁移；失效旧存档可明确选择新文件重新关联；不同目录同名文件隔离，目标已有存档时拒绝静默覆盖。无位置注释显示“待重新定位”。文件缺失不自动重建，未解决冲突重开后仍保留。类型检查、10 项单元测试、6 组 Chrome E2E 与生产构建通过；新增工作目录 E2E 使用真实 OPFS 目录/文件，系统选择框和本机目录授权仍需人工验证。本次仅本地提交，未部署。

**已完成**：第 1 节需求 1–10 全部实现并通过上述测试。

**GitHub 公开仓库（2026-10-03）**：[LioraRndr/Writee](https://github.com/LioraRndr/Writee)，默认分支 `main`，本机 `origin` 已配置并完成首次推送。上传前完成源码密钥检查、类型检查、10 项单元测试与生产构建；补齐 `Agent.md` 入口与环境配置 / 同步临时文件忽略规则。

**Windows 启动（2026-10-03）**：Node 与 PowerShell 启动器均优先选择 Chrome，支持系统安装与当前用户安装路径；Chrome 未安装时回退到 Edge。`scripts/window-icons.ps1` 静默维护应用窗口的原生 ICO 图标，按 DPI 选择尺寸；窗口全部关闭后自动退出。150% 缩放下原生 48×48 图标读回与源资源逐像素一致，用户已确认任务栏图标清晰。

**尚未验证 / 已知限制**
- 未用真实 API Key 实测任何服务商（只有模拟测试）；第三方服务的跨域策略各不相同，必要时用“本地代理转发”。
- 中文输入法组字、Safari/Firefox、触屏未测试。
- 图片只显示 http(s)/data 链接，相对路径的本地图片显示为占位（没有目录访问权限）。
- 超长文档（> 10 万字、数百个小节）在卡片模式下每张卡片一个编辑器，未做虚拟化。
- 存档只在本浏览器；清除站点数据会丢失注释，没有导出/导入存档功能。
- 写回文件失败时内容只保留在浏览器存档中（顶栏显示“保存失败 · 重试”）。
- 系统默认程序的实际外部打开未自动化（注入与请求路径已验证），需在本机确认文件关联；生产主包约 1.24MB，仍有 Vite 分包提示。
- 后台标签页不轮询磁盘，切回时才检查；刷新后标签页列表恢复但不自动载入（文件授权需要用户点击）。
- 表格单元格“选中后直接打字进入编辑”未做（中文输入法在非可编辑元素上不会开始组字，需点击或 Enter 进入编辑）。
- 2026-10-28 的改动未在本机 Chrome 跑 `file-sync`、`workspace` 两组 E2E（云端容器无法运行），请在本机补跑。

**可做的下一步（按价值排序，供参考）**
1. 存档导出 / 导入（注释与分析的备份、换电脑迁移）。
2. 注释栏“列表视图”（窄屏已支持覆盖式单栏互斥）。
3. AI 根据注释直接给出修改稿并做差异对比、逐条接受。
4. 本地图片：申请目录权限后解析相对路径。
5. 卡片视图虚拟化，支持超长文档。
6. 结构分析分块（超长文章分段请求再合并）。
7. 按需拆分 KaTeX 与编辑器主包，消除 Vite 分包提示。
8. 标签页：后台标签页低频轮询外部修改；标签页分组或固定。

## 8. 常见坑

- File System Access API 只在安全上下文可用：`localhost` 或 `https`。用 IP 访问 `http://` 时会退化为存档模式。
- Windows 上 Vite 热更新可能读到 rclone 正在写入的 `*.partial` 临时文件，出现一次性报错，保存完成后会恢复。
- CodeMirror 开启自动换行后，End 键移动到“视觉行”末尾而非段落末尾（写测试时注意）。
- `npm run build` 使用 `tsc --noEmit` 再 `vite build`；box 上构建请输出到 `/tmp`，不要写进挂载盘。

## 9. 服务器部署交接

涉及线上部署、配置、域名、版本或服务器文件时，启动先读 `D:\R_Program\服务器\projects\writee\STATE.md` 和 `OUTBOX.md`；收尾向该格子的 `INBOX/` 投递部署简报。服务器维护目录是部署事实真源。运维手册在 `D:\R_Program\服务器\scripts\writee\README.md`。

2026-10-03 已部署 https://writee.sakisaki.top/，固定提交 `4925a1c4a96c0921079bb8909bd3b13ea4f264d1`；Nginx 直接提供静态产物，17 项公网与隔离 Chrome 5 项生产验收通过。线上无本地 Vite AI 代理；localhost 和线上域名的浏览器存档彼此独立，没有服务器跨设备同步。真实 API Key 和系统文件选择框写回未验证。
