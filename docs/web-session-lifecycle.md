# Web 会话保留与资源回收

普通网页会话从最后一次客户端保活起保留 10 分钟。网页每 20 秒为本页启动或打开的终端续约；短暂断线回到原页面后继续使用原 PTY，并补取服务器仍缓存的输出。关浏览器、断网或系统冻结页面可能无法发出停止请求，因此以服务端计时回收为准，不能依赖 React 卸载或 beforeunload。

设置中的“后台保留当前会话”适用于需要关网页后继续执行的长任务。开启后不因离线超时结束，重新打开网页可从设置中的后台会话列表打开原终端或结束它。主动点终端关闭、设置中的停止或后台列表的结束会终止该会话，即使已开启后台保留。普通网页刷新会新建终端，原普通会话在没有其他页面续约时到期回收；不承诺刷新后自动还原所有标签。

服务器只保存每个终端最近 64 KiB、最多 1024 个输出片段。附着和重连使用输出序号去重，过早内容已淘汰时显示提示。这是终端近期输出缓存，不是 Codex 完整历史；Codex 已写入磁盘的历史仍通过原历史会话入口恢复。普通会话被回收会中断仍在运行的任务，不会删除工作区文件和 Codex 历史。

## 保护边界

- 默认最多 32 个活动终端，后台会话计入额度。环境变量 CODE_TERMINAL_MAX_SESSIONS 可配置 1–128。
- CODE_TERMINAL_IDLE_TIMEOUT_SECONDS 默认 600，允许 2–86400；小值用于隔离回归测试，正式部署使用 600。
- Linux 创建终端和历史查询前读取服务 cgroup 的任务额度，保留最多 128 个、至少 8 个任务余量；临近上限返回 503 和可操作的中文说明。
- 终端启动并发 1、显式清理并发 2、历史查询并发 2。终端线程使用可失败的创建方式，失败回滚子进程和注册信息，避免线程创建失败直接 panic。
- Linux 回收本 PTY 的会话 ID 对应进程，包括不同前台进程组，核对进程启动时间后发送 TERM/KILL 并重扫；只清理该终端，不全局结束 codex。已经独立脱离 PTY 的共享 daemon 不在回收范围。
- Windows 服务器使用 PID 限定的子树结束与有界等待；极端资源不足导致 taskkill 无法启动时，只能用直接子进程结束兜底。该限制不影响本次 Linux 生产部署。
- 临时 Codex 历史查询使用非阻塞输出、8 秒截止、1 MiB 输出上限、2 KiB 初始请求上限，并在所有返回路径清理本次 helper；没有无限等待的额外读/收尾线程。
- 旧缓存页面不支持心跳时，不自动启用 lease。新前端根据 events_ticket.sessionLease 发送 terminal_start.lease=true；首次 heartbeat/attach 也启用回收。旧客户端仍受会话数量和任务额度限制，应刷新到新版获得完整生命周期管理。
- 保留生产 TasksMax=1024 和既有内存限制。资源保护减少普通使用的积累风险，不承诺无限会话或任意子进程负载。

## 接口与验证

新增接口均沿用现有 Bearer 鉴权：GET terminal_sessions、POST terminal_heartbeat、POST terminal_background、POST terminal_attach。终端 ID 用于已有授权会话定位，未增加匿名管理接口。attach 返回有界 output、outputSequence、outputTruncated，可按 afterSequence 补取增量。

- cargo test --manifest-path src-tauri/Cargo.toml --bin code-terminal-server --no-default-features --locked：Windows 与 Linux 均通过 16 项，另 1 个被主测试显式启动的子进程 fixture 标记 ignored。
- python tests/terminalLifecycle.py：隔离 Debian 12 容器真实 PTY，验证心跳存活、断线续接、到期回收 Shell 和前台任务、后台保留、主动结束、失效上报、容量拒绝但首页可访问、旧客户端兼容、cgroup 任务压力和 15 次创建/关闭后线程不增长。
- playwright-cli run-code --filename tests/terminalLifecycle.browser.js：验证真实 20 秒保活周期、后台开关、快照/增量竞态、断线重连、取消附着不误杀、停止失败取消续约、旧端兼容以及 320/390/884px 长路径文字和按钮边界。
- 原移动输入和软键盘浏览器回归、40 项前端测试及 Windows exe 构建通过。浏览器截图已检查；手机软键盘仍为 Chromium 模拟，未替代 Android/iOS 真机验证。
- 生产同机独立实例（127.0.0.1:18789、独立状态文件、3 秒测试期限）验证真实 PTY、鉴权、回收与后台保留通过，测试实例已停止。正式后端切换需要重启，不能无损迁移旧内存中的 PTY。
