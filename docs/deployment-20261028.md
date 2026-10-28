# Code Terminal 部署记录

2026-10-28，用户授权将本机 `D:/freelife/opencode-workbench` 独立部署到 `8.148.225.35`，并明确接受公网 HTTP。应用版本为 `0b2a374dcb0e660b8feb8a433c1671b6c84c3308`；文档提交不改变应用产物。

- 地址：`http://8.148.225.35:8787/`，须携带本产品访问令牌。HTTP 不加密令牌和终端内容。
- 程序与静态页面：`/opt/code-terminal/`。
- 服务：`code-terminal.service`，开机自动启动，失败自动重启。
- 运行账号：`code-terminal`；工作目录：`/opt/code-terminal-state/workspaces`。
- 状态：`/opt/code-terminal-state/workbench-state.json`；环境：`/etc/code-terminal.env`，root 所有，权限 600。
- systemd 使用只读系统目录、专用可写目录、禁止提权及私有临时目录；无 Docker socket、sudo 或其他产品目录访问权限。
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
