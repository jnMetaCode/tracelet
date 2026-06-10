# 发布攻略（内部）—— tracelet 中文版

[English](./LAUNCH.md) | 简体中文

> 状态：**发布前清单已全部完成**（包已上线 npm v0.1.0、GIF、文案就绪）。
> 计划在 skillet 发布约两周后启动（三连发的收官）。

## 发布前清单 —— ✅ 全部完成

- ✅ npm `@jnmetacode/tracelet` 已发布并验证
- ✅ Hero GIF（终端 + 浏览器实录，`docs/demo-term.tape` + `docs/record-ui.mjs`
  可复现重录）
- ✅ Python OTel 接入示例经真实 SDK 验证（`examples/python-opentelemetry.md`）
- ✅ Viewer 通过 XSS 探针（渲染任意 trace 数据安全）
- ⬜ *(可选)* `NPM_TOKEN` secret（未来 CI 自动发布用）

## Show HN 发帖

**时机**：skillet 发布后约两周，周二/周三、太平洋时间早 8 点，前 3 小时
逐条回复。

**标题**（直接粘贴）：
> Show HN: Tracelet – Local-first DevTools for AI agents (npx, no account)

（中文意思：Tracelet——AI agent 的本地优先 DevTools（npx 即用、无需账号））

**正文**：直接粘贴英文版 LAUNCH.md 里的 Show HN body。中文释义：

> 我以前调试 agent 全靠 console.log 打印提示词、眯着眼找哪个工具调用出了
> 问题。托管的追踪平台对内层开发循环来说太重——注册、装 SDK、把提示词发到
> 别人的云上。tracelet 反过来：`npx @jnmetacode/tracelet`，把任何 OpenTelemetry
> exporter 指向 localhost:4318，agent 的执行树就实时流进来——LLM 调用、工具
> 调用、输入输出、token、延迟、报错。零依赖、无账号、无 Docker、无 Python，
> 内存环形缓冲，数据不出机器。三套常见 span 语义（OTel gen_ai.*、Vercel AI
> SDK ai.*、OpenInference）都认识，LangChain/LlamaIndex/Vercel AI SDK 不用装
> 任何 tracelet SDK。它刻意不做生产分析仓库——它是你构建 agent 时开在第二个
> 窗口的东西，agent 运行的 Network 面板。用大了就迁去 Langfuse/Phoenix，
> 标准 OTLP 不用重新埋点。

**回评论要点**：
- 被问"和 Langfuse/Phoenix 比"→ 直接引用 README 的对比表角度：它们是仓库，
  tracelet 是 Network 面板；不是竞品是上下游
- 被问数据安全 → 内存 ring buffer、不落盘、不外发；viewer 对任意 trace
  数据做了转义（XSS 探针验证过）
- Python 用户 → 指到 `examples/python-opentelemetry.md`（真实 SDK 验证过）

## 其他渠道（文案在英文版里粘贴即用）

- **r/LocalLLaMA / r/LangChain**：完整帖已写好，开头放 GIF
- **X 线程**：四条推已写好（"你的 agent 是黑盒，这是它的 Network 面板"），
  发布时 @ Vercel AI SDK 和 OpenTelemetry 社区
- **dev.to**：《我为 AI agent 写了个零依赖本地追踪器》教程帖兼 SEO

## 有起色之后

- GitHub Sponsors
- issue 里呼声最高的框架 → 出一行接入的包装（`tracelet/vercel` 等）
- 远期 open-core 切口：可选的"团队共享 trace 链接"托管功能——但要等本地
  工具先有用户群
