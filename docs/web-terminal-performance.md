# Web 终端性能诊断与优化

## 实现

Web 通过已有认证 WebSocket 顺序发送输入，事件票据返回 `terminalInput: true` 表示支持。旧服务端未声明能力时继续使用串行 HTTP；WebSocket 写入失败后不会改用 HTTP 重发，避免重复命令。

客户端最多允许 8 帧、64KiB 未确认数据；每帧输入最多 64KiB UTF-8。待发滚轮保留有界最新方向，普通键入也可连续发送。服务端校验递增序号、字段、大小，并在 PTY 实际写入后确认；错误、重复序号或超时终止连接。连接重建只接收新的明确输入。粘贴作为确认屏障，确认后保留 180ms 间隔再允许提交；失败会取消输入框待发回车。

服务端开启 TCP_NODELAY，减少交互小包等待合并。既有 TUI 位移匹配、灰色思考输出、普通终端历史和对话阅读位置逻辑保留。

## 本地数字埋点

默认关闭，无上传，无持久化。在浏览器开发者工具中：

```js
window.codeTerminalPerf.enable();
window.codeTerminalPerf.reset();
// 执行待测操作后：
window.codeTerminalPerf.snapshot();
window.codeTerminalPerf.enable(false);
```

每项最多保留最近 240 个数字样本，报告数量、p50、p95、最大值：

| 指标 | 含义 |
| --- | --- |
| inputQueueMs | 输入等待客户端队列发送的时间 |
| socketAckMs | WebSocket 发送到 PTY 写入确认的时间 |
| httpWriteMs | 兼容模式 HTTP 请求时间 |
| wheelToRenderMs | 相隔至少 250ms 的单独滚轮，到随后输出触发 xterm render 的时间 |
| outputToRenderMs | 输出到达至 xterm render 的时间 |
| scrollSyncMs | 文字位移匹配与滚动位置同步计算耗时 |
| snapshotMs | 对话视图 TUI 文本快照计算耗时 |
| longTaskMs | 浏览器主线程超过 50ms 的任务 |

另记录 socket/http 写入次数、积压、失败、合并滚轮、输出和渲染次数。报告不包含命令、终端内容、会话 ID、地址或凭据。连续滚轮和输出无法逐个关联，`overlappingWheels` 单独计数，不把上一轮输出错当成本轮的近零延迟。xterm render 也不等于物理屏幕呈现。

## 可重复验证

- `npm run test:frontend`：39 项，通过有序管道、背压、确认失败、超时、断线不重放、粘贴间隔、埋点默认关闭/上限/隐私。
- `cargo test --manifest-path src-tauri/Cargo.toml --bin code-terminal-server --no-default-features --locked`：9 项通过。
- `python tests/terminalSocketAuth.py`：隔离真实服务，匿名票据/连接 401，一次性票据复用拒绝，缺失会话明确错误。
- `playwright-cli run-code --filename tests/terminalSocketTransport.browser.js`：模拟 180ms ACK，连续输入在首个 ACK 前送达、中文粘贴独立回车、断线取消回车、不重发、重连后明确输入通过。
- `tests/terminalSocket.browser.js`：真实 PTY 协议序号/ACK 顺序和重复输入拒绝。
- `tests/mobileInteractions.browser.js`、`tests/terminalQuickScroll.browser.js`、`tests/terminalScrollSync.browser.js`：旧版 HTTP 兼容、移动端/平板、两个视图、字体放大及延迟滑块回归通过。
- `tests/terminalLatency.browser.js`：专用本地服务上运行真实 Codex `/status`，1440×960，16 次单独滚轮与 60 次每 16ms 的连续滚轮；不发起模型请求。报告文字变化后的 rAF 耗时及内置埋点。

## 2026-10-29 测量

在同一服务器运行独立新版实例，通过同一 SSH 隧道分别测试正式旧版与新版，保留生产会话。单次滚动中位数约 67–75ms，未显示稳定收益。密集 60 次滚轮：文字更新间隔中位数 49.6 → 34.0ms、最长间隔 132.7 → 67.4ms、松手尾延迟 99.7 → 63.9ms；HTTP 写入 22 → 0，改为 60 个有序 WebSocket 输入帧。两版均无 >50ms 主线程长任务。

该对照只代表本次路径和负载，SSH 隧道改变了网络路径，不能与先前公网直连 168ms 数字直接比较，也不是物理 exe 的测速。TUI 自身可能合并重绘，无法保证 60fps。手机/平板是 Chromium 触控模拟，未替代真机 Safari 测试。

Windows exe 与 Linux 服务端已构建。新版预发布包位于 `/opt/code-terminal/ws-release-20261029/`；生产已有活动 Codex 会话，切换需要重启，仅在用户同意后执行。当前文档不表示已正式发布。
