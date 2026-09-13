<div align="center">

# 🔭 tracelet

### AI agent 的本地优先 DevTools

**实时看到每次工具调用、每条提示词、每个 token——100% 在你的机器上。**
不注册、不用 Docker、不用 Python。一条 `npx @jnmetacode/tracelet` 就够了。

```bash
npx @jnmetacode/tracelet
```

[English](./README.md) | 简体中文

![tracelet 演示 — agent trace 实时流入；查看 LLM 调用（提示词、token）和报错的工具调用](docs/demo.gif)

</div>

---

你的 agent 是个黑盒：它调用 LLM，LLM 要求执行工具，工具返回了奇怪的东西，
下一次 LLM 调用就开始犯傻——而你在终端里只能看到最终答案（或者一个堆栈）。

**tracelet** 就是这个循环里缺失的检查器。把任何 OpenTelemetry exporter 指向
`localhost:4318`，agent 的执行树就实时流进一个秒开的本地 UI：每次 LLM 调用、
每次工具调用、输入的提示词、输出的补全、token 数、延迟和报错。

任何数据都不会离开你的机器。

## 快速开始

```bash
# 1. 启动 tracelet（自动打开 http://localhost:4321）
npx @jnmetacode/tracelet

# 2. 用一条合成的 agent trace 看看效果
npx @jnmetacode/tracelet & sleep 1 && node examples/demo.js

# 3. 发送同一个 agent 的两次运行，然后对比（Compare 按钮）
node examples/demo.js --compare
```

用的是 **Vercel AI SDK（v7+）** 或 **LangChain.js**？一行，不用装任何 OpenTelemetry 包：

```js
import '@jnmetacode/tracelet/ai-sdk/register';                       // AI SDK：放在入口文件最顶部
await agent.invoke(input, { callbacks: [tracelet()] });               // LangChain：来自 '@jnmetacode/tracelet/langchain'
```

其他框架：把 agent 的 OpenTelemetry exporter 指向摄取端点：

```
http://localhost:4318/v1/traces
```

这是标准 OTLP/HTTP 端口——大多数场景只需要：

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

两种 OTLP/HTTP 编码都支持：**protobuf**（exporter 的默认格式）和 **JSON**。
不需要设置 `OTEL_EXPORTER_OTLP_PROTOCOL`。

## 对比两次运行

改了一句 prompt、换了个模型、修了一个工具——真正要回答的问题是：*agent 的行为到底变了什么？*
选中一次运行，按 **Compare**（或键盘 `c`），再点另一次运行：

- **步骤逐行对齐。** 多出来的重试、丢掉的工具调用、新增的步骤显示为 `+ added` / `− removed`，
  其余步骤保持对齐，不会整体错位。
- **每个有变化的步骤都打标**——`status`、`model`、`input`、`output`——并给出该步骤在
  A、B 两侧以及 Δ 的延迟、token、成本。
- **prompt 与 completion 的逐行 diff** 在右侧检视器中展示。
- **顶部汇总差异**：延迟、token、成本、错误数——B 相对于 A。
- **钉住基线**（`p`）：之后每一次新流入的运行都会自动和它对比——边改边跑的回归检查。

运行列表本身可以搜索（`/`）：名称、模型、工具名，以及 prompt / completion / 工具载荷的全文——命中的 span 会在瀑布图里高亮。

瀑布图上按住拖选一段时间范围即可放大（30 秒的运行里 40 毫秒的工具调用也能看清）；`Esc` 或双击复位。

`node examples/demo.js --compare` 会发送一对"修复前 / 修复后"的运行，不用接真实 agent 就能试。
用 `#compare=<a>,<b>` 可以直接深链到一次对比。

## 与你现有的技术栈即插即用

tracelet 同时理解三套常见的追踪语义约定，无论 trace 是谁发出的都能直接渲染：

| 来源 | 接法 |
| --- | --- |
| **Vercel AI SDK v7+** | **一行、零额外依赖：** `import '@jnmetacode/tracelet/ai-sdk/register'`。见 [`examples/vercel-ai-sdk`](examples/vercel-ai-sdk.md)。 |
| **Vercel AI SDK v5/v6** | `experimental_telemetry: { isEnabled: true }` → OTLP 导出到 `localhost:4318`。同一篇文档。 |
| **Python OTel SDK**（LangChain、CrewAI、OpenAI Agents SDK……） | 标准 exporter 原样可用（含 protobuf）。见 [`examples/python-opentelemetry`](examples/python-opentelemetry.md)。 |
| **LangChain.js / LangGraph.js** | **一行、零额外依赖：** `{ callbacks: [tracelet()] }`，来自 `@jnmetacode/tracelet/langchain`。见 [`examples/langchain`](examples/langchain.md)。 |
| **Mastra** | `@mastra/otel-exporter` 的 `custom` endpoint 指向 `localhost:4318`。见 [`examples/mastra`](examples/mastra.md)。 |
| **OpenInference**（LangChain、LlamaIndex、CrewAI…） | 任何导出 OTLP 的 OpenInference instrumentor。 |
| **OpenTelemetry GenAI** 语义约定 | 原生 `gen_ai.*` span，内容在属性*或*事件里都行。 |
| **任何 OTel** | 普通 span 也能渲染——只是少一些语义增强。 |

没有 SDK 锁定：tracelet 就是一个 OTLP 端点加一个查看器。

## 为什么还需要一个新工具？

LLM 可观测性工具已经不少，但没有一个真正服务于 JS/TS agent 开发者的
**内层调试循环**：

| | 本地离线 | 免账号 | 免 Docker | 免 Python | 实时开发流 | `npx` 一条命令 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| **tracelet** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Arize Phoenix | ✅ | ✅ | ✅ | ❌ (pip) | ~ | ❌ |
| Langfuse（自托管） | ✅ | ✅ | ❌ (PG+ClickHouse+Redis) | ~ | ❌ | ❌ |
| Laminar（自托管） | ✅ | ✅ | ❌ (PG+ClickHouse+RMQ) | ~ | ~ | ❌ |
| LangSmith | ❌ | ❌ | — | — | ✅ | ❌ |
| Helicone | ~（代理） | ❌ | ❌ | ~ | ~ | ❌ |

tracelet 不打算做你的生产分析仓库。它是你*构建* agent 时开在第二个窗口里的
那个工具——就像浏览器的 Network 面板，只不过看的是 agent 的运行。

> 本地不够用了？tracelet 收发的是标准 OTLP，上生产时换成上面任何一家都不用
> 重新埋点。

## 工作原理

```
你的 agent ──OTLP/HTTP (pb|json)──▶  :4318  ──▶  内存存储  ──SSE──▶  UI :4321
                                        （环形缓冲，永不写盘外传）
```

- **零依赖。** 纯 Node 内置模块，整个项目几百行，全部可读。
- **两个端口。** `4318` 摄取 OTLP（约定俗成），`4321` 提供 UI。
- **内存环形缓冲。** 保留最近 500 条 trace。重启即清空——除非你主动开启
  `--persist <文件>`，把历史存进本地 JSONL（仍在你的磁盘上，仍然不外发；
  Clear 也会一并清掉文件）。
- **成本估算。** trace 和 LLM span 会按常见模型（Claude/GPT/Gemini）的公开
  标价显示 `~$` 估算；不认识的模型就不显示——绝不瞎猜。

## CLI

```
npx @jnmetacode/tracelet [选项]
  -p, --port <n>      OTLP/HTTP 摄取端口   （默认 4318）
      --ui-port <n>   Web UI 端口          （默认 4321）
      --persist <f>   可选本地历史（JSONL，启动时自动恢复）
      --no-open       不自动打开浏览器
```

## 路线图

- [x] 可选本地历史（`--persist traces.jsonl`）—— 已完成
- [x] 两次运行的并排对比（Compare：步骤对齐、prompt/输出 diff、Δ 延迟/token/成本）——已完成
- [x] 按模型估算成本（trace 和 LLM span 显示 `~$`）—— 已完成
- [x] protobuf OTLP 摄取（零依赖解码器）—— 已完成
- [x] 瀑布图缩放（在时间条上拖选范围；Esc / 双击复位）——已完成
- [x] Vercel AI SDK 一行接入（`@jnmetacode/tracelet/ai-sdk`，零依赖）——已完成
- [x] Mastra：纯配置接入 `@mastra/otel-exporter`（`examples/mastra.md`）
- [x] LangChain.js / LangGraph.js 一行接入（`@jnmetacode/tracelet/langchain`，零依赖）——已完成

欢迎 PR。项目尚早——issue 和想法是当前最有价值的贡献。

## 状态

早期 MVP。摄取 + 实时 UI 今天就能用（跑 `node examples/demo.js` 即可看到）。
欢迎 Star/Watch 关注进展。

## 姊妹项目

同属一个小巧、本地优先、零依赖的 AI agent 工具套件——见
[套件总览与端到端示例](https://github.com/jnMetaCode/local-agent-toolkit)：

- 🔭 **tracelet** —— 调试 agent 运行的本地 DevTools *(本仓库)*
- 🍳 **[skillet](https://github.com/jnMetaCode/skillet)** —— agent 技能包管理器
- 🧠 **[engram](https://github.com/jnMetaCode/engram)** —— agent（和你）的本地私有记忆层

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
