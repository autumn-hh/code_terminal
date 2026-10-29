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

2026-10-29 13:36（Asia/Shanghai），用户明确允许中断活动会话后，已将 `320e5a9` 的前后端正式发布并重启 `code-terminal.service`。服务 active/running、自动重启次数 0；公网静态文件逐个 SHA-256 校验一致，事件票据声明 `terminalInput: true`。前端为 `index-qlGXyxBa.js` / `index-Bw5xPw5Q.css`。回退副本位于 `/opt/code-terminal/backup-ws-20261029-133642/`，预发布包仍保留。

发布后公网直连桌面 1440×960、真实 Codex `/status`，16 次单轮的文字变化后帧中位数 67.0ms、p95 83.4ms；30 次连续滚轮全部走 WebSocket、HTTP 写入 0，文字更新间隔中位数 50.0ms、p95 82.9ms，最后一次更新在松手后 166.6ms。页面错误和 >50ms 主线程长任务均为 0。客户端队列 p95 0.1ms，滑块同步 p95 0.2ms。

`python .playwright-cli/scroll-sync-public.py` 公网真实 Codex 双向滚轮与拖动同步通过，页面错误 0；新截图已回读。测试创建的 PTY 均已停止。匿名 API 401、原凭据 API 200，已有认证继续有效。本轮仅更新本产品二进制和前端，保留状态与认证配置。

此前公网旧版单轮中位数 168.1ms、p95 383.1ms，连续更新间隔中位数 82.7ms。本次结果明显改善，但两轮并非同时测试，网络情况不同，不能把全部差值归因于代码。公网网络抖动和 TUI 重绘仍会影响尾延迟。报告位于本机未跟踪 `output/playwright/scroll-latency-ws-public.json`。Windows exe 已随应用构建更新。

## 滚动条兼容性小修（2026-10-29）

程序内部滚动的握柄改为轨道高度的 10%，限制在 32–72px，并保证不超过轨道高度；真实历史仍按可见区域占内容的比例显示。可见宽度和触控命中区域保持原样。

滚轮归属与 xterm 一致：备用缓冲区、VT200/drag/any 鼠标协议由程序处理；普通缓冲区的 none/X10 使用真实历史。X10 仅报告点击，不能视作程序接管滚轮。程序只切换模式、不重绘文字时，解析完成事件也会更新控件；平常文字位移仍在渲染后确认，不按输入量虚构进度。

验证记录：

- `npm run test:frontend`：40/40 通过，新增普通/备用缓冲区与五种鼠标模式组合。
- `npm run build:frontend`：TypeScript 与生产构建通过。
- `playwright-cli run-code --filename tests/terminalQuickScroll.browser.js`：X10 真历史、普通缓冲区三种滚轮协议、模式切换、单步不重复发送、响应式握柄通过。
- `playwright-cli run-code --filename tests/terminalScrollSync.browser.js`：180ms 延迟、忽略输入、反向、边缘按住/释放、失焦取消、视图切换通过。
- `playwright-cli run-code --filename tests/mobileInteractions.browser.js`：移动端输入、中文组合、独立粘贴/回车、触屏历史/TUI、折叠屏和平板回归通过。
- 本机专用服务 8788，真实 Codex 0.165.0 默认与 `--no-alt-screen`、Git 自带 `less --mouse` 与 `vim -u NONE -i NONE -n -R`（`mouse=a`），桌面双向滚轮、鼠标拖动和 390×844 触摸拖动均使文字与握柄同步。测试使用独立会话，结束后关闭测试 PTY；Codex 仅执行 `/status`。less 在 EOF 拒绝继续向下时，握柄保持不动；往返滚动另在文件中段验证。
- 新截图已回读：360/390 手机、884×1104 平板、884×420 矮屏及 150% 显示缩放/22px 长文字。触屏是 Chromium 模拟，未覆盖真机 Safari。

兼容边界：通用全屏 TUI 不公开总行数，握柄仍是相对导航，不能提供 Word 式精确总进度；无可匹配文字的整屏替换也不会猜测位移。Codex 内联模式可得到真实历史滚动条，本轮不修改默认启动命令或全局 Codex 配置。

13:54（Asia/Shanghai）已静态重新部署到 `/opt/code-terminal/dist`，入口为 `index-BtHjMCdq.js`；6 个公网文件 SHA-256 与本地一致，服务 active，匿名 API 401、已有凭据 API 200。未重启后端，现有会话继续运行。入口回退文件为 `/opt/code-terminal/index.before-scroll-sync-20261029-135409.html`。`python .playwright-cli/scroll-sync-public.py` 公网真实 Codex 双向滚轮和拖动同步通过，页面错误 0，测试会话已关闭。`npm run build` 已重新生成 Windows exe。
