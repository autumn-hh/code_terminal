# TUI 滚动同步修正

用户在电脑浏览器访问公网服务器时，右侧滑块与实际文字移动不同步。旧实现按滚轮像素或请求步数提前推进滑块，但 xterm 的 TUI 协议事件和程序实际滚动距离不等价；拖动还会产生多次并发 HTTP 写入。

`TerminalSessionView.tsx` 和 `terminalProgramScroll.ts` 在 xterm 渲染后匹配至少两条不同内容行的共同位移，再更新位置；`TerminalQuickScroll.tsx` 不再自行累加输入量，拖动只根据指针增量发送有界请求。位置属于终端会话，切换对话/终端视图保留。普通历史和对话记录继续使用实际本地滚动位置。

`terminalInputQueue.ts` / `tauriRuntime.ts` 将 Web 输入按会话串行化。同方向 SGR 滚轮最多合并三步、待发滚轮最多保留三步，反向覆盖尚未发送的旧方向。普通键入、粘贴和回车保持独立顺序；粘贴失败时拒绝队列中的提交，网络延迟不能将粘贴结束和回车挤成一批。

验证：

- `npm run test:frontend`：31/31，通过。包括延迟、无变化、部分位移、反向、resize、重复文本、队列串行/合并/上限/反向替换/失败和粘贴间隔。
- `npm run build:frontend`、`npm run build`：通过；Windows `src-tauri/target/release/code-terminal.exe` 重建，9,657,344 字节。
- `playwright-cli run-code --filename tests/terminalScrollSync.browser.js`：180ms 模拟响应延迟下，画面未移动时滑块不动，确认输出后共同移动；拖动、边缘持续滚动/释放、窗口失焦取消、切视图保持位置通过；输入请求最大并发 1。
- `tests/terminalQuickScroll.browser.js`：普通历史和对话拖动/滚轮、输出保留阅读位置、触屏取消、Home/End、轨道翻页、长文字与窄滚动条边界通过。替换原来假设“无输出也应移动滑块”的断言。
- `tests/mobileInteractions.browser.js`：Enter、Shift+Enter、空输入导航、中文组合、Tab、延迟粘贴、触屏历史/TUI、折叠屏/平板、工具栏和输入框回归通过。
- 本地真实 Codex 0.165.0：使用 `/status` 生成输出，滚轮双向、拖动、触屏滑动均确认文字与滑块同向变化。
- 公网 `http://8.148.225.35:8787/` 真实 Codex：桌面 1440×960，滚轮双向和拖动通过，脚本错误 0，仅创建一个测试 PTY，结束后停止。未发起模型请求。
- 实际回读桌面、360px 手机、1180px 平板、150% 显示缩放/22px 字号及公网截图；未见新增文本溢出或滚动条遮挡。另覆盖 390×844、884×1104、884×420 等尺寸。截图保存在未跟踪 `output/playwright/`。

发布前端 `index-D6m-9MSt.js` / `index-Bw5xPw5Q.css`，6 个公网文件 SHA-256 与本机 dist 一致。旧 hash 文件保留，index 原子替换，回退入口 `/opt/code-terminal/index.before-scroll-sync-20261029-114753.html`。服务仍 active，匿名 API 401、认证 API 200。本次未重启服务，无后端代码修改。

限制：任意 TUI 不提供总历史长度，滑块总范围仍是估计；整屏跳转无可匹配行、重复文本或布局变化时保持位置，不能声称全程序精确百分比。滚动意图确认窗口为 2.5 秒，更长停顿可能不更新。移动端使用 Chromium 触控模拟，未替代真实手机浏览器和系统键盘验证。
