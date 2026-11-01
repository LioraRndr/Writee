# Writee 开发指南（接手必读）

记录接手所需的约束与当前状态；详细历史见 [docs/DEVLOG.md](docs/DEVLOG.md)，用户说明见 [README.md](README.md)，分析格式见 [docs/structure-format.md](docs/structure-format.md)。
**每次开发结束前更新第 7 节和 DEVLOG。**

## 0. 动手前注意

- **当前开发目录是 macOS 的 `/Volumes/AnonBox/R_Program/Writee`**，源码、依赖、`Writee.app` 和启动脚本都在这里；旧 outputs 路径只是符号链接。继续使用 `localhost:5173` 和现有 Chrome 存档。
- Swift 启动器以解析符号链接后的应用父目录为项目根；改 Swift 后必须重新编译并本地签名。
- 界面文案与必要注释用中文；沿用无分号、单引号、2 空格风格。不引入 UI 组件库；UI 颜色使用 CSS 变量，新变量补齐 `theme.css` 五套主题。
- 同步盘可能有多人同时修改：先读目标文件，不覆盖他人改动。Linux box 上**绝不要安装、删除或改动同步盘的 `node_modules`**，它属于 Windows。

## 1. 产品与技术栈

Writee 是本地 Markdown 写作工具：实时编辑并写回原文件，标题大纲、相对层级嵌套卡片、选区标签与注释连线、注释提示词、句子级结构分析，以及 BYOK 的 OpenAI / Anthropic 兼容接口。注释和分析只进存档，不写进 Markdown。

React 19 + TypeScript + Vite 8 + CodeMirror 6 + zustand；IndexedDB（idb-keyval）；diff-match-patch；markdown-it、KaTeX、Mermaid、DOMPurify；@anthropic-ai/sdk 和 Mermaid 按需加载；字体为 Noto Serif SC + Instrument Serif。

## 2. 运行环境

### macOS / Windows 本机

```bash
npm install          # 依赖损坏时用 npm ci
npm run dev          # http://localhost:5173
npm run typecheck
npm test
npm run build
```

- File System Access 只在 `localhost` 或 HTTPS 可用；普通 HTTP/IP 会退化为存档模式。
- Windows 的 `scripts/launch-writee.vbs` 后台启动 Vite，通过 `writee-launch.json` 验证服务，再优先打开 Chrome app 窗口，未安装时回退 Edge。相关启动与注册脚本改动前先确认现状。
- 独立 Electron 版固定使用 `http://127.0.0.1:5183`，与浏览器、线上存档互不迁移。

### Linux box（历史远程环境）

| 路径 | 用途 |
| --- | --- |
| `/home/box/Writee-live` | rclone 源码挂载盘，只在这里改源码 |
| `/home/box/.writee-deps` | 本地依赖、Vite、测试与构建副本 |
| `/home/box/sync-writee.sh` | 按时间戳同步源码，跳过依赖、dist、日志 |
| `/home/box/restart-vite.sh` | 重启 5173 |

```bash
/home/box/sync-writee.sh
cd /home/box/.writee-deps
./node_modules/.bin/tsc --noEmit -p .
./node_modules/.bin/vitest run
CHROME_PATH=/usr/bin/google-chrome node e2e/run-all.mjs
./node_modules/.bin/vite build --outDir /tmp/writee-dist
```

不要用 `pkill -f vite`；用 `pgrep -f "[n]ode_modules/.bin/vite"` 取 PID。挂载盘上不做大量小文件操作。

## 3. 目录速查

```text
src/
  core/        纯逻辑：types / sections / cardOps / mapping / math / svg / table
               links / localFile / sentences / notesPrompt / archive / fileAccess
               pdf / pdfRender / mermaid / derive / platform 及单元测试
  store/       docStore（全文、撤销、卡片）；uiStore；session（文件与多标签页）
  editor/      CodeMirror 同步、实时预览、公式/图表/表格/链接部件、覆盖层与定位
  components/  Workspace、卡片、注释/结构栏、大纲、标签栏、动效与全部对话框
  analysis/    标签体系、提示词、通用 AI、流式分析、分析文件导入导出
  styles/      fonts / theme / app / editor / cards / rail / pdf
e2e/           Chrome 与 Electron 端到端测试
desktop/       Electron 主进程、隔离 preload、回环静态与限权文件服务
scripts/       各平台启动、文件授权与原子打开队列
docs/          格式文档与开发日志
```

## 4. 数据流

```text
CodeMirror 输入 → useDoc.applyChanges / applyTransform / replaceText
  → 保存不可变 DocData 快照用于撤销
  → PosMapper 映射 tags / units / edits / anchors，并重建小节树
  → 发出 { origin, touched, map }
  → 其他视图用 minimalChange + syncAnnot 同步，覆盖层 RAF 重排
  → session：500ms 写存档、700ms 写回文件
```

- 全文与全文字符偏移是唯一事实来源；注释、结构、修改位置都由此派生。
- 多标签页只把当前文档装入 `useDoc`。`session.park()` 保存正文、撤销历史、文件状态、磁盘基线、模式、折叠和滚动位置；`unpark()` 原样恢复并立即检查磁盘。
- 标签页列表存在 `writee.tabs`；刷新只恢复列表，点选时再载入。后台页不轮询磁盘。

## 5. 关键约定与不变量

1. **文本事务**：任何正文变化必须走 `applyChanges` / `applyTransform` / `replaceText`，不得直接改 `data.text`。DocData 不可变，更新时创建新对象/数组。
2. **视图同步**：来源相同的输入只更新 base；其他来源加 `syncAnnot`，禁止回写。撤销/重做的 origin 是 `history`。
3. **手动修改**：只记录 `userEdit: true`；磁盘修改和撤销不算。复制注释提示词据此加入“不要替换成原来的文字”提醒。
4. **卡片结构**：层级按相对关系计算，唯一 H1 可视为文档标题；移动父级时由 `moveSection` 平移整节标题。`anchors` 保持标题 id 稳定，折叠按 id 存档。
5. **聚焦重排**：卡片内输入新标题后，等失焦再拆卡，避免光标被打断。
6. **浮层定位**：统一 page 坐标，优先 DOM 徽标；虚拟化缺 DOM 时用 `registry.posBox`，重排走 `registry.requestLayout()`。未定位卡片用 `usePlacementClass` 隐藏，聚焦必须等定位后。
7. **AI 请求**：只有 `api.anthropic.com` 才添加官方自适应思考、effort、fallbacks、beta 与缓存参数；第三方只发标准字段和用户额外参数。默认模型 `claude-opus-5-5`。
8. **存储**：注释、分析、修改痕迹、折叠只存 IndexedDB `writee`；设置存 localStorage：`writee.settings`、`writee.ai`、`writee.copyopts`、`writee.pdf`，标签页列表为 `writee.tabs`。
9. **动效**：统一 `components/motion.ts`，尊重 reduced-motion。CardEditor 必须在 layout effect 挂载后再做 FLIP 测高；折叠由 `cards/fold.ts` 克隆旧内容，标题不模糊、不淡入。折叠 FLIP 逐个读位置，时长 240–460ms、曲线 `FOLD_EASE`。
10. **表格写回**：`core/table.ts` 统一模型；局部差异必须加表格起点并交给当前视图构造全文 ChangeSet。控制器挂在 DOM 上，`updateDOM` 原地更新；`rendering` 忽略重建 focusout，失焦提交不抢焦点。部件按键阻止冒泡，避免重复撤销。
11. **表格布局**：`.cm-content` 必须 `min-width: 0`。表格按内容收缩、最宽到可用宽度，长格换行、短格不折行；不要给列设固定最小宽度。进入编辑时保持原格宽。
12. **本机系统动作**：open/reveal 复用限权令牌和 localhost POST；相对路径以当前 Markdown 目录解析，禁止 shell 拼接，网页版不伪造真实路径。
13. **多标签页队列**：打开、切换、关闭统一走 `serial()`，内部递归用 `*Impl`。新文档走 `present(id, install)`；恢复期间 `quiet` 禁止自动写回。Workspace 按 `meta.id` 重挂载，滚动位置应用后清除。
14. **排版与字体**：正文禁止 `pwid`，显式 `'pwid' 0`，避免全角标点被本机思源宋体收窄。
15. **窄屏**：≤900px 时左栏留在文档流中挤压正文，宽度用 `--outline-eff = min(--outline-w, 46vw)`；右栏覆盖且两侧互斥。只在进入窄屏时收起侧栏，切标签页不重复收起。
16. **块级部件**：公式块、表格根节点只用 padding 不用 margin（CodeMirror 测高不计 margin）。视图插件替换装饰不得跨换行；跨行公式交给 `mathBlockField`。
17. **Mermaid / SVG**：跨行图表统一由 `diagramBlockField` 渲染；原始和生成 SVG 都经 `core/svg.ts`，禁止脚本、事件、外部资源与导航。Mermaid 动态加载、全局串行、strict 模式；异步任务需代次/销毁保护并请求测高。无宽高 SVG 按 viewBox 恢复尺寸。
18. **桌面与启动队列**：Electron 仅用固定 5183 回环来源；服务只提供 dist、限权文件和原生对话框，不含 Vite/通用代理。Host、Origin、自定义头校验不可省略。Finder、第二实例和参数统一进入 `local-launch.cjs` 原子队列。
19. **PDF**：`pdfRender.ts` 从全文生成安全 HTML，注释和编辑装饰不导出。预览与打印共用 `.pdf-sheet`；`@page` 负责纸张、页边距、页眉页码，不能在固定页脚用 `counter(page)`。图表先传纯文本占位再换安全 SVG，公式扫描跳过占位。
20. **桌面 PDF**：只经 `desktop/preload.cjs` 暴露 `savePdf`；IPC 校验当前窗口和回环来源后调用 `printToPDF()`。浏览器回退系统“存储为 PDF”。
21. **调试钩子**：开发模式 `window.__writee = { useDoc, useUI, registry, session, buildNotesPrompt, importAnalysis, buildManualPrompt }`；改名必须同步 e2e。
22. **撤销与点击**：表格和公式部件不得破坏全文撤销、注释映射及 CodeMirror 高度表；撤销后落在表格内时恢复单元格选择，而非强制显示源码。

## 6. 测试

```bash
npm run typecheck
npm test
npm run dev          # 另一个终端保持运行
npm run e2e
npm run e2e:desktop  # 先构建；退出占用 5183 的 Writee
```

- 单元测试：标题、映射、切句、提示词、分析导入、公式、表格/TSV、链接、本机路径与系统动作安全、PDF 规则。
- 浏览器 E2E 共 10 组：`annotate`、`cards`、`file-sync`、`workspace`、`ai-mock`、`layout`、`local-file`、`editing`、`tabs`、`pdf`。覆盖对应功能的完整交互、两种编辑模式、窄屏、真实文件、公式/表格定位及真实 PDF 字节。
- 可用 `WRITEE_URL`、`CHROME_PATH`、`SHOTS=目录`；PDF 验收可用 `PDF_OUT=路径`。
- 桌面 E2E 使用临时存档，覆盖冷启动、离线图表、无 Node 全局、真实写回、单实例/内标签、原生对话框和 PDF 文件；`WRITEE_DESKTOP_EXECUTABLE` 可测打包应用。
- 系统文件选择框、真实 API Key、IME、Safari/Firefox 和实际外部程序打开仍需人工验证。云端旧 Chromium 的 OPFS 句柄崩溃会让 `file-sync` / `workspace` 失败，应在本机 Chrome 跑。

## 7. 当前状态（2026-11-01）

- **PDF 导出**：四套预设、纸张方向、字体字号、行距页边距、段间距、强调色、标题、三级目录、页眉页码及缩放预览已完成；设置存 `writee.pdf`。浏览器真实 PDF 和页码已验收，桌面直接保存代码及 E2E 已写好。
- **最近能力**：Mermaid/SVG、相对路径本地图片与缩放、独立 Electron 桌面壳、macOS 默认 Markdown 打开与窗口复用均已完成。更早的编辑器、卡片、注释、AI、表格、多标签页等需求也已实现；过程见 DEVLOG。
- **最新验证**：类型检查、24 项单元测试、生产构建、本机 Chrome 全部 10 组 E2E，以及 CI macOS 桌面 E2E（含真实 PDF）均通过。
- **已发布**：[Writee v0.2.0](https://github.com/LioraRndr/Writee/releases/tag/v0.2.0)，包含 macOS arm64/x64 DMG 和 Windows x64 EXE；安装包未签名/公证。发布 CI 会先跑桌面 E2E，再上传 Release。
- 最新 `dist/` 已构建；本次未部署线上网页。

### 已知限制

- 未用真实 API Key 实测；IME、Safari/Firefox、触屏未测试。
- 纯网页 FSA 入口仍不读取相对路径本地图片；本机启动器和桌面版可以。
- 卡片模式未虚拟化，超长文档可能较慢；存档只在当前浏览器/桌面来源，无备份迁移功能。
- 后台标签页不轮询磁盘；刷新后需点选载入。表格不支持“选中后直接打字”进入编辑。
- 主包约 1.40MB，仍有 Vite 分包提示。

### 后续候选

存档导入导出、注释列表视图、AI 差异改稿、FSA 相对图片、卡片虚拟化、长文分析分块、主包拆分、后台标签页低频轮询/分组。

## 8. 常见坑

- 不要把编辑器局部 ChangeSet 直接用于全文；不要把跨行替换装饰放进视图插件；不要给块级部件加垂直 margin。
- Windows 同步时 Vite 可能短暂读到 `*.partial`，保存完成后通常恢复。
- CodeMirror 自动换行时 End 到视觉行末，不是段落末；写测试需注意。
- `npm run build = tsc --noEmit + vite build`；box 构建输出到 `/tmp`，不要写挂载盘。

## 9. 部署交接

线上为 <https://writee.sakisaki.top/>，2026-10-03 部署提交 `4925a1c4a96c0921079bb8909bd3b13ea4f264d1`，Nginx 提供静态文件，无线上 AI 代理或跨设备存档同步。

涉及部署先读 `D:\R_Program\服务器\projects\writee\STATE.md` 与 `OUTBOX.md`，以服务器维护目录为事实真源；收尾向该格子的 `INBOX/` 投递简报。运维手册在 `D:\R_Program\服务器\scripts\writee\README.md`。
