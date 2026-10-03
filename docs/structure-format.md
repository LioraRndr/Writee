# Writee 结构分析文件格式（writee-structure/1）

结构分析以**句子**为基本单位：一个“分析单元”覆盖一句或相邻的几句，并带有 1–4 个标签，第一个标签为主标签（决定在编辑器中的颜色）。

## 切句规则

- 句末标点：`。！？!?…`（连续的终止符视为一个，如 `？！`、`……`），以及后接空白的英文句点；
- 句末的右引号、右括号等（`”’」』）)】》`）归入前一句；
- 标题、列表项各自成句；代码块、表格、HTML、分隔线不参与切句；
- 同一段落内的软换行不会打断句子。

句子从 1 开始编号。“复制分析提示词”会把编号后的全文一并给出，AI 只需引用编号。

## 文件格式（导入 / 导出用）

```json
{
  "format": "writee-structure/1",
  "source": { "title": "文章名", "sentences": 128, "chars": 5321 },
  "generatedBy": "claude-opus-5-5",
  "createdAt": "2026-10-03T08:00:00.000Z",
  "summary": {
    "thesis": "中心论点（一句话）",
    "structure": "全文结构概括，如：总—分—总……",
    "comment": "整体评价与最重要的 1–3 条修改建议"
  },
  "units": [
    {
      "sentences": [3, 4],
      "text": "单元开头的原文",
      "tags": ["arg.claim", "method.contrast", "rhet.parallelism"],
      "role": "第二个分论点",
      "note": "对比不够鲜明，可补充一个反例"
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `units[].sentences` | 句子序号区间（闭区间，从 1 开始）。单句写作 `[5, 5]` |
| `units[].text` | 单元开头的一小段原文。文章改动后序号可能错位，导入时会用它重新定位（推荐填写） |
| `units[].tags` | 标签 id，见下表；也接受中文标签名 |
| `units[].role` | 该单元在文中的作用（≤20 字） |
| `units[].note` | 写法点评或修改建议（≤40 字，可省略） |

## AI 流式输出（JSON Lines）

一键分析时，AI 按行输出紧凑格式，Writee 边接收边标注：

```
{"s":[1,1],"q":"慢下来，才能写","t":["struct.title-point","arg.thesis"],"r":"标题点明论点"}
{"s":[2,3],"q":"在这个人人都能","t":["arg.background","craft.hook"],"r":"以现象开篇","n":"可换成更具体的场景"}
{"summary":{"thesis":"…","structure":"…","comment":"…"}}
```

`s` = sentences，`q` = 开头原文，`t` = tags，`r` = role，`n` = note。“导入分析结果”同时接受这种 JSON Lines 和上面的完整 JSON 文件。

## 标签体系

### 论证要素（`arg`）— 议论文的论证构件

| 标签 id | 名称 | 含义 |
| --- | --- | --- |
| `arg.thesis` | 中心论点 | 全文的核心主张 |
| `arg.claim` | 分论点 | 支撑中心论点的下一级主张 |
| `arg.question` | 提出问题 | 引出要讨论的问题、现象或矛盾 |
| `arg.background` | 背景交代 | 交代讨论的背景、语境或前情 |
| `arg.definition` | 概念界定 | 定义或解释关键概念 |
| `arg.premise` | 前提假设 | 论证所依赖的前提（含隐含前提） |
| `arg.evidence-fact` | 事实论据 | 事例、史实、新闻、亲身经历 |
| `arg.evidence-data` | 数据论据 | 统计数字、调查或研究结果 |
| `arg.evidence-authority` | 引证论据 | 名言、经典、专家或文献观点 |
| `arg.reasoning` | 分析推理 | 由论据推出结论的分析过程 |
| `arg.concession` | 让步 | 承认对立观点的合理之处 |
| `arg.counter` | 反驳 | 指出对立观点的错误 |
| `arg.counterexample` | 反例 | 用反面事例检验或削弱某个论断 |
| `arg.qualification` | 限定条件 | 限定论断的适用范围或条件 |
| `arg.conclusion` | 结论 | 论证得出的结果或判断 |
| `arg.solution` | 对策建议 | 提出解决办法、倡议或行动 |

### 论证方法（`method`）— 组织论据、推出论点的方式

| 标签 id | 名称 | 含义 |
| --- | --- | --- |
| `method.example` | 举例论证 | 用具体事例证明观点 |
| `method.reason` | 道理论证 | 用道理、常识、原理证明观点 |
| `method.quote` | 引用论证 | 引用名言、经典、权威观点 |
| `method.contrast` | 对比论证 | 正反、古今、彼此对照 |
| `method.analogy` | 类比论证 | 借相似事物推理（含比喻论证） |
| `method.causal` | 因果论证 | 分析原因与结果的关系 |
| `method.hypothetical` | 假设论证 | 假设某种情形并推演后果 |
| `method.reductio` | 归谬法 | 顺着对方逻辑推出荒谬结论 |
| `method.progressive` | 层进论证 | 层层递进、逐步深入 |
| `method.classification` | 分类论证 | 分门别类、分层次展开 |
| `method.induction` | 归纳 | 由多个个别事实概括一般结论 |
| `method.deduction` | 演绎 | 由一般原理推出个别结论 |

### 结构功能（`struct`）— 句段在篇章中的位置与作用

| 标签 id | 名称 | 含义 |
| --- | --- | --- |
| `struct.opening` | 开篇引入 | 开头引出话题 |
| `struct.topic` | 总起/中心句 | 统领一段或一部分的句子 |
| `struct.elaboration` | 展开阐释 | 对上文的进一步解释、展开 |
| `struct.supplement` | 补充说明 | 补充细节、例外或附加信息 |
| `struct.transition` | 过渡 | 连接前后内容 |
| `struct.bridge` | 承上启下 | 既总结上文又引出下文 |
| `struct.turn` | 转折 | 话锋或语义转向 |
| `struct.foreshadow` | 铺垫/伏笔 | 为后文做准备 |
| `struct.climax` | 升华 | 把内容推向更高的意义层面 |
| `struct.summary` | 总结收束 | 归纳、收束上文 |
| `struct.echo` | 首尾呼应 | 与前文（尤其开头）相呼应 |
| `struct.title-point` | 点题 | 直接点明题旨 |

### 表达方式（`expr`）— 五种基本表达方式

| 标签 id | 名称 | 含义 |
| --- | --- | --- |
| `expr.narration` | 叙述 | 交代人物、事件的经过 |
| `expr.description` | 描写 | 描绘人物、景物、场面的状态 |
| `expr.argument` | 议论 | 发表看法、评价、判断 |
| `expr.lyric` | 抒情 | 抒发情感 |
| `expr.exposition` | 说明 | 客观解说事物的特征、原理 |

### 修辞手法（`rhet`）— 词句层面的修辞

| 标签 id | 名称 | 含义 |
| --- | --- | --- |
| `rhet.metaphor` | 比喻 | 明喻、暗喻、借喻 |
| `rhet.personification` | 拟人 | 把物当作人来写 |
| `rhet.parallelism` | 排比 | 三项及以上结构相似的句子成分 |
| `rhet.antithesis` | 对偶 | 字数相等、结构相同的对称句 |
| `rhet.hypophora` | 设问 | 自问自答 |
| `rhet.rhetorical-q` | 反问 | 以问句表达确定的意思 |
| `rhet.hyperbole` | 夸张 | 有意夸大或缩小 |
| `rhet.repetition` | 反复 | 有意重复词句以强调 |
| `rhet.contrast` | 对比映衬 | 用相反或相关事物互相衬托 |
| `rhet.climax` | 层递 | 按程度、范围逐层推进 |
| `rhet.metonymy` | 借代 | 以相关事物代替本体 |
| `rhet.synesthesia` | 通感 | 感官之间的挪移 |
| `rhet.irony` | 反语反讽 | 正话反说或反话正说 |
| `rhet.allusion` | 用典 | 引用典故、成语、诗文 |
| `rhet.pun` | 双关 | 一语兼顾两层意思 |

### 写作技法（`craft`）— 叙事、描写与谋篇的技巧

| 标签 id | 名称 | 含义 |
| --- | --- | --- |
| `craft.hook` | 开头钩子 | 用悬念、反常、冲突抓住注意力 |
| `craft.anecdote` | 故事化 | 用小故事承载观点 |
| `craft.detail` | 细节描写 | 抓住细微之处刻画 |
| `craft.scene` | 场景描写 | 环境、场面的描绘 |
| `craft.psychology` | 心理描写 | 刻画内心活动 |
| `craft.dialogue` | 对话描写 | 用人物语言推动或刻画 |
| `craft.sketch` | 白描 | 简练勾勒、不加渲染 |
| `craft.side` | 侧面烘托 | 借他人他物衬托主体 |
| `craft.small-big` | 以小见大 | 从小处折射大主题 |
| `craft.suppress` | 欲扬先抑 | 先抑后扬或先扬后抑 |
| `craft.symbol` | 象征/托物言志 | 借具体事物寄托抽象意义 |
| `craft.imagery` | 意象 | 富含情感或意义的物象 |
| `craft.suspense` | 悬念 | 设置疑问吸引读者往下读 |

### 语气立场（`tone`）— 作者的语气与立场强度

| 标签 id | 名称 | 含义 |
| --- | --- | --- |
| `tone.assert` | 断言 | 语气确定、立场鲜明 |
| `tone.hedge` | 保留推测 | 留有余地的判断 |
| `tone.emphasis` | 强调 | 刻意加强语势 |
| `tone.emotive` | 情感渲染 | 调动读者情绪 |
| `tone.address` | 对话读者 | 直接呼告或与读者交流 |
| `tone.skeptic` | 质疑批判 | 怀疑、批评的立场 |
| `tone.humor` | 幽默调侃 | 轻松、诙谐的语气 |

### 问题诊断（`issue`）— 值得修改的地方

| 标签 id | 名称 | 含义 |
| --- | --- | --- |
| `issue.weak` | 论证薄弱 | 论据不足以支撑论断 |
| `issue.leap` | 逻辑跳跃 | 缺少中间推理环节 |
| `issue.no-evidence` | 缺少论据 | 只有断言、没有支撑 |
| `issue.overgeneral` | 以偏概全 | 概括过度或绝对化 |
| `issue.inconsistent` | 前后矛盾 | 与上下文观点冲突 |
| `issue.vague` | 表述含糊 | 语义不清、指代不明 |
| `issue.redundant` | 冗余重复 | 与上文重复或可删减 |
| `issue.cliche` | 套话/AI腔 | 空泛、模板化、堆砌的表达 |
| `issue.off-topic` | 偏离主题 | 与中心论点关系不大 |
| `issue.fact-check` | 待核实 | 事实、数据或引文需要核实 |
