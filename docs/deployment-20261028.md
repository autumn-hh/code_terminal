# Code Terminal 部署记录

## 2026-10-30 Web 访问故障恢复

01:47 排查发现首页请求超过 12 秒无响应，但 8787 端口可连接、未鉴权 API 仍能返回 401，systemd 一直显示 active。日志从 10 月 29 日 20:28 起出现 `failed to spawn thread`、`Resource temporarily unavailable`（EAGAIN）。服务 cgroup 的 `TasksCurrent=255`、`TasksMax=256`，`pids.events` 记录 278 次触顶；该额度同时包含 Web 服务、终端 Shell、Codex 与子进程的线程。当时共 29 个进程，包含 8 个 Codex 进程，内存与磁盘仍有余量。

执行 `systemctl set-property code-terminal.service TasksMax=1024` 在线提高并持久化额度，生成 `/etc/systemd/system.control/code-terminal.service.d/50-TasksMax.conf`。没有重启服务、停止用户终端或改动其他应用；MainPID 保持 2684906，启动时间保持 2026-10-29 14:29:26。复查 TasksCurrent=259、TasksMax=1024，恢复后日志无新增异常。

实际验证：首页连续三次 200（0.17–0.25 秒）；带凭据的 `GET /api/load_state` 200，`POST /api/events_ticket` 200 且 `terminalInput=true`。公网 Playwright 独立测试终端执行 `seq 1 60`，确认真实 PTY 输入输出、手机/折叠屏布局和设置切换正常，页面脚本错误 0，测试终端已停止。用户同时确认访问恢复。

后续部署保留 1024 的有界任务额度。`active` 和端口监听不等于网页健康；复发时同时检查首页响应、鉴权 API、TasksCurrent/TasksMax 与 `pids.events`。本次未修改应用代码或强制清理已有 Codex/MCP 进程；长期异常增长仍需依据进程树另行定位。

## 2026-10-28 初始部署

2026-10-28，用户授权将本机 `D:/freelife/opencode-workbench` 独立部署到 `8.148.225.35`，并明确接受公网 HTTP。应用版本为 `0b2a374dcb0e660b8feb8a433c1671b6c84c3308`；文档提交不改变应用产物。

- 地址：`http://8.148.225.35:8787/`，须携带本产品访问令牌。HTTP 不加密令牌和终端内容。
- 程序与静态页面：`/opt/code-terminal/`。
- 服务：`code-terminal.service`，开机自动启动，失败自动重启。
- 初次运行账号为 `code-terminal`，2026-10-29 按用户明确要求改为 `root`；当前工作目录为 `/opt`，HOME 为 `/root`。原工作目录仍保留。
- 状态：`/opt/code-terminal-state/workbench-state.json`；环境：`/etc/code-terminal.env`，root 所有，权限 600。
- 当前取消系统只读、HOME 隔离、专用目录写入和空能力集等低权限配置，可直接读写项目目录。继续屏蔽 Dify、FileSync 目录和共享 Docker socket，保留用户此前的产品边界；这不是对 root 进程的严格安全隔离。
- 原 `8.130.142.159` 部署保留，本次未操作。

SSH 账号 `root` 属于服务器管理账号，不是理财工作台或 Code Terminal 的网页登录账号。用户授权保存的 SSH 密码及新生成的 Code Terminal 令牌分别保存在本机 Windows 凭据管理器的 `codex:ssh:8.148.225.35:root` 与 `code-terminal:http:8.148.225.35:8787` 条目中。本文及 MCP 均不记录秘密值。

本机认证启动器为 `C:/Users/hh/AppData/Local/CodeTerminal-launcher/open-code-terminal.cmd`，从凭据管理器读取令牌并打开浏览器，脚本不含秘密值。页面随即清除地址栏中的令牌，只保留在当前标签页会话。

服务端在本机 Docker 的 `rust:1-bookworm` 中按 Cargo.lock 构建，生产不安装编译工具。上传的二进制和 6 个前端文件逐个校验 SHA-256；公网静态文件再次与本机 dist 对照一致。

实际验证：

- `npx --no-install tsc --noEmit`：通过。
- `npm run test:frontend`：24 项通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --bin code-terminal-server --no-default-features --locked`：8 项通过。
- `npm run build:frontend`、`npm run build`：通过，Windows exe 已重建。
- Linux 容器 `cargo build --release --locked --no-default-features --bin code-terminal-server`：通过。
- `systemd-analyze verify /etc/systemd/system/code-terminal.service`：通过。
- `systemctl is-active code-terminal.service`：active；`ss` 确认 8787 监听。
- 公网页面 200；匿名 `/api/load_state` 返回 401；正确令牌返回 200。
- Playwright 真实公网浏览器创建 PTY，执行输出标记、`id -un` 与 `pwd`，确认用户为 code-terminal、工作目录正确；测试终端已停止。
- 桌面 1440×960、窄屏 390×844 和 360×740 截图已回读，无页面横向溢出及脚本错误。仅验证本次部署关键路径；未重跑全部触屏手势、TUI 或第三方模型工作流。

截图及报告位于本机 `output/playwright/deploy-20261028-*`，未纳入提交。当前服务是独立终端工作台；未迁移旧服务器项目列表、文件、CLI 配置或模型登录信息。

2026-10-29 收尾复查：服务 active/running、开机启动 enabled、重启次数 0；同机理财应用、MySQL 和项目代理的容器身份与启动时间均与部署前一致。理财 `/readyz` 与公开采集页面返回 200，匿名采集会话返回预期的 401。Dify、FileSync、共享代理、DNS 和证书未改动。

## 2026-10-29 目录权限与选择器修正

用户截图位于 `/opt`，出现 `Permission denied (os error 13)`。初次部署的低权限账号不能在 `/opt` 新建，且理财目录被显式屏蔽；目录打开失败后前端仍保留旧列表，造成位置误解。用户随后明确要求本产品默认最高权限部署，已切换 root，令牌和项目状态保持原样。unit/env 回退副本位于 `/opt/code-terminal/backup-root-20261029-014351/`，目录权限 700、环境副本 600。仅重启 Code Terminal。

目录选择器增加“工作目录”入口（返回服务工作目录，当前 `/opt`），打开失败清空旧列表并禁用选定按钮，权限错误显示可操作的中文说明；新建成功自动进入子目录。读取/创建/选择期间互斥，防止误选旧目录。弹窗使用可伸缩列表，兼容错误提示的出现和消失。

本地完整服务与独立临时库中验证：失败后旧列表清空、工作目录恢复、创建失败保留名称、新建进入子目录、选择项目落库；1440×960、390×844、360×740、320×568、390×420 页面边界与按钮通过、无脚本错误。初次测试清理曾因 Windows PTY 子进程占用临时目录失败，随后仅清理本次子进程，完整重跑退出码 0。

## 2026-10-29 平板与多目录修正

`src/App.tsx` 将目录内容放入独立滚动区，底部取消/选择按钮保留在外；`src/styles.css` 限制对话框高度、避免列表条目压缩，并为平板提供居中 760px 面板、路径辅助行、较大的字体和至少 44px 触控按钮。键盘压缩视口时，内容区可滚动，确认按钮保持可见。长名称/路径显示省略并保留完整 title，输入框保持可编辑完整路径。

- `D:/Users/hh/miniconda3/python.exe tests/projectPicker.browser.py`：通过（退出码 0）。真实本地服务、隔离状态库、160 个长名称文件夹，验证列表滚动末尾/进入/返回、当前目录实际选择落库、失败清空/恢复、创建失败保留输入和成功进入。
- Chromium 触控模拟覆盖 1440×960、768×1024、820×1180、1180×820、1024×768、884×420、390×844、360×740、320×568、390×420、533×683。短视口模拟键盘收缩，533px 宽作为放大后的窄布局；未替代真机系统键盘及 Safari 实测。
- 截图回读：`output/playwright/picker-many-*`；未发现页面横向溢出、长名称跨格或底部按钮被遮挡。脚本错误 0。
- `npm run test:frontend`：24/24；`npm run build:frontend` 和 `npm run build`：通过，Windows exe 重建。
- 公网发布 `index-BMrQtTyQ.js` / `index-Bw5xPw5Q.css`。6 个静态文件 SHA-256 与本机 dist 一致；旧 hash 资源保留，index 原子替换，回退入口 `/opt/code-terminal/index.before-tablet-20261029-015913.html`。此轮静态发布无服务重启。
- 公网平板浏览器实际在 `/opt` 创建临时项目、选择并启动 PTY，`id -u` 为 0，cwd 正确；测试终端、项目、空目录均清理。页面 200、匿名 API 401、令牌 API 200。
- 同机 wealth 三个容器 ID/启动时间与基线一致；readyz 和公开采集入口 200，匿名 session 401。未操作 Dify/FileSync 或共享入口。

## 2026-10-29 服务器 Codex

安装官方 Codex CLI 0.165.0（Linux x86_64 musl），入口 `/usr/local/bin/codex`，包目录 `/root/.codex/packages/standalone/releases/0.165.0-x86_64-unknown-linux-musl`。服务器官方脚本下载停滞，改在本机下载同一官方 GitHub release 完整包及 checksum manifest，分别与官方 release API 的 SHA-256 对照，再上传服务器复核，按官方目录布局解包并建立 symlink。未安装 Node/npm，也未改其他服务。SSH 和公网 Code Terminal PTY 中 `codex --version` 均输出 `codex-cli 0.165.0`。

用户指定配置写入 `/root/.codex/config.toml`（目录 700、文件 600），保留 `OpenAI` provider、`https://apexapi.roixw.com/v1`、responses API、`gpt-5.5` model/review_model、模型目录 URL、自定义 header 和用户指定功能开关。密钥仅在该 root 私有配置，不写入 Git、日志和 MCP。

验证限制：配置可被普通 `codex exec` 读取并显示正确模型/provider，但当前 CLI 忽略三个旧字段 `disable_response_storage`、顶层 `network_access`、`windows_wsl_setup_acknowledged`；严格配置检查拒绝这些字段，不能声称它们生效。保留用户原始配置，未降低 Codex 沙箱默认值。

在服务器独立空临时目录执行无工具、仅回复 OK 的 ephemeral smoke：CLI 返回 429 Too Many Requests，退出码 1。直接请求该网关 `/responses` 返回 502 `Upstream access forbidden, please contact administrator`；`/models` 200 但未列出 `gpt-5.5`，CLI 也报告缺少模型 metadata。CLI 安装、PATH 和配置已完成，模型回答仍受第三方上游限制，待接口方开通/恢复；没有擅自替换用户指定模型。
