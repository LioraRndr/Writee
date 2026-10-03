# 开发日志

按时间倒序记录每次开发会话做了什么、为什么、留下了什么问题。新会话请在顶部追加。

---

## 2026-10-03 · GitHub 公开仓库上传准备

- 按用户要求准备创建公开的 `Writee` 仓库；原项目尚未初始化 Git。
- 检查源码与资源文件，未发现真实 API Key、GitHub Token 或私钥；BYOK 配置、注释和文档存档位于浏览器，不在上传文件内。
- 保留原有依赖 / 构建 / 日志忽略规则，增加 `.env`、`.env.*` 和 `*.partial`，保留 `.env.example` 可提交。
- 新增 `Agent.md` 入口，链接现有 `CLAUDE.md` 与 `AGENTS.md`。
- 类型检查、10 项单元测试、生产构建通过；构建产物写入系统临时目录。
- 本机 GitHub 登录凭据失效，已启动设备授权；仓库创建与上传待授权完成。

---

## 2026-10-03 · 会话 2：通用 AI 接口、动效、侧栏调宽、交接文档

**通用 AI 接口**（`src/analysis/ai.ts`、`components/dialogs/AIDialog.tsx`）
- 配置改为两种接口格式：OpenAI 兼容（`{base}/chat/completions`）与 Anthropic 兼容（官方 SDK，`{base}/v1/messages`），各自保存 Base URL / Key / 模型名（自由填写）。旧配置自动迁移。
- 官方专属参数（自适应思考 + effort、`fallbacks: "default"`、提示词缓存）只在 Base URL 为 `api.anthropic.com` 时发送；第三方不走 beta 端点，避免未知参数报错。
- 新增：快速填写预设、获取模型列表、测试连接、高级选项（最大输出 tokens、认证方式、额外请求参数 JSON）、输出截断提示。
- 本地代理路径改为 `/__proxy/<scheme>/<host>/<path>`，支持 `http://`（如本地 Ollama）。

**动效**（`src/components/motion.ts` 等）
- 卡片与大纲：FLIP 重排动画（嵌套元素只补偿相对位移）、折叠/展开高度动画、新卡片入场、删除退场后再删。
- 注释卡片与结构标签：入场动画；修复首次定位时从屏幕外“飞入”的问题（`usePlacementClass`）。
- 平滑滚动跳转（远处位置到达后再校正一次）、模式与侧栏切换淡入、配色切换颜色过渡、弹窗与提示条退场、连线绘制动画、按钮按压反馈；尊重“减少动态效果”。

**侧栏调宽**（`src/components/Resizer.tsx`）
- 大纲右边缘、注释/结构栏左边缘可拖拽调宽，拖动时直接改 CSS 变量，松手写入设置；双击恢复默认。大纲收起改为宽度过渡。

**测试与文档**
- 新增 `e2e/` 端到端测试套件（5 组，带断言）和 `npm run e2e`；新增 `AGENTS.md`、`CLAUDE.md`、本日志；README 更新。
- 回归中发现并修复：注释卡片定位前处于隐藏状态导致输入框无法聚焦，新建注释后的输入落进了正文。

**事故记录**
- 本会话早先在 box 上清理挂载盘里残留的 `node_modules` 时，后台的 `rm -rf` 一直运行到用户在 Windows 上重新 `npm install` 之后，删掉了同步过来的部分依赖（例如 `@anthropic-ai/sdk/lib/middleware.mjs`）。已停止，需在 Windows 上 `npm ci` 修复。教训已写入 AGENTS.md 第 0 节：box 上不要碰 `node_modules`。

**同期其他会话的改动（非本会话）**
- `public/`（favicon、apple-touch-icon、logo、`writee-launch.json`）、`scripts/`（Windows 启动器与桌面快捷方式）、`index.html` 的图标引用。

---

## 2026-10-03 · 会话 1：从零搭建

- 技术选型：Vite + React + TypeScript + CodeMirror 6 + zustand；File System Access API 直接读写本地文件；IndexedDB 存档。
- 编辑器：实时预览（光标处显示 Markdown 标记，表格块级渲染，任务列表可点击），全局撤销（DocData 快照）。
- 大纲导航与拖拽排序；卡片视图（相对层级嵌套、拖拽改顺序与层级、按钮与快捷键操作、聚焦时推迟结构重排）。
- 注释：数字标签、多标签注释、与正文对齐的注释栏和连线、端口拖拽连线、关联模式、标签弹出框、搜索/筛选/批量。
- 复制给 AI：三种上下文范围、【n】标记、附加指令、“手动修改”提醒与改动句子列表。
- 结构分析：8 类 90 个标签、按句编号的提示词、JSON Lines 流式标注、writee-structure/1 文件格式、手动标注、图例筛选、总评。
- 文件同步：自动写回、2 秒轮询外部修改并按 diff 对齐注释、冲突处理、最近文档、示例文章。
- 外观：思源宋体 + Instrument Serif（数字与中文标点交给思源宋体）、五套配色、字号/行距/版心可调。
- 性能：长文（4 万字、160 个小节）逐键开销压到一帧以内（字数防抖、大纲行 memo、注释卡片只订阅自身原文）。
