# Code Terminal

一个面向多项目开发的桌面终端工作台。它把常用项目、本地终端、单 Tab / 多瓦片布局和外观配置放在一个轻量窗口里，适合同时维护多个代码仓库、频繁切换命令行上下文的开发者。

> Built with Tauri, React, TypeScript, Rust and xterm.js.

## 界面预览

![Code Terminal preview](docs/code-terminal-preview.png)

## 下载

- [下载 Windows exe](https://github.com/autumn-hh/code_terminal/releases/download/app-v0.1.0/code-terminal.exe)
- [下载 macOS dmg（Apple Silicon）](https://github.com/autumn-hh/code_terminal/releases/download/app-v0.1.0/Code%20Terminal_0.1.0_aarch64.dmg)
- [下载 macOS app（zip，Apple Silicon）](https://github.com/autumn-hh/code_terminal/releases/download/app-v0.1.0/code-terminal-macos-app.zip)
- [查看所有发布文件](https://github.com/autumn-hh/code_terminal/releases/tag/app-v0.1.0)
- [查看最新发布](https://github.com/autumn-hh/code_terminal/releases/latest)

Windows 和 macOS 产物都由 `Release` 工作流上传到同一个 Release：`code-terminal.exe` 是 Windows 便携版，`Code Terminal_<版本>_aarch64.dmg` 是 macOS 安装包，`code-terminal-macos-app.zip` 是免安装的 app 压缩包。当前 `app-v0.1.0` 已经提供 Windows exe，macOS 的 dmg / app zip 需要等包含 macOS 构建的发布上线后才可下载；如果链接暂时不可用，到「查看最新发布」里找最新文件，或按下面「构建 macOS dmg」本地打包。Linux 版本仍在验证中。

## 平台状态

- **Windows**：主力支持平台，当前优先打磨和发布。
- **macOS**：已支持打包，Release 会自动产出 Apple Silicon 的 app 和 dmg；未配置签名和 notarization，首次启动会被 Gatekeeper 拦截，需要右键打开或在「系统设置 → 隐私与安全性」里允许。
- **Linux**：计划支持，已准备自动构建；不同发行版依赖和桌面环境仍需要继续验证。

## 适合谁

- 经常在多个项目之间来回切换，需要快速打开不同项目终端的人
- 希望一个窗口里同时看多个命令、日志、构建任务的人
- 想要比系统终端更贴近项目工作流，但又不想引入笨重 IDE 面板的人
- Windows 用户，尤其是习惯直接打开本地 exe 管理多个项目的人

## 亮点

- **项目列表**：保存常用项目目录，支持拖动排序，默认优先打开排在前面的项目。
- **目录快捷打开**：点击项目行里的文件夹图标，可直接在系统文件管理器中打开对应目录。
- **项目复用**：点击项目时，如果对应终端已经存在，会直接切回现有终端；如果当前终端为空，会绑定到当前终端；否则自动新建终端。
- **单 Tab / 多瓦片**：单 Tab 模式只显示当前终端，其他终端保持后台运行；多瓦片模式会把多个终端同时铺开。
- **拖拽停靠布局**：在多瓦片模式下拖动终端标题栏，可把终端停靠到目标瓦片的上、下、左、右或中间，拖拽只调整布局，不会停止终端进程。
- **真实本地 PTY**：后端创建本地伪终端，支持交互式命令、ANSI 颜色、resize 和常规 shell 工作流。
- **项目窗口标题**：窗口标题和左上角显示当前项目文件夹名，任务栏里更容易区分多个项目窗口。
- **外观可调**：内置多套主题，也支持编辑并保存自定义主题；字号和行间距都可以直接输入。
- **图片粘贴桥接**：在界面中粘贴图片后，应用会临时保存图片，让 TUI 或命令行程序读取对应文件路径。
- **多项目入口**：可以从当前应用里打开另一个项目窗口，不用反复手动点 exe。

## 快速开始

窗口固定显示终端，已移除“终端 / 对话”切换按钮和设置入口，旧的对话视图偏好不再生效。底部辅助输入框保持 Enter 发送、Shift+Enter 换行，单 Tab / 多瓦片布局仍可在设置中调整。

复制窗口内容：电脑直接拖选文字，手机长按文字后拖动选区手柄，选区旁会出现「复制到剪贴板」和「粘贴到输入栏」。后者在当前草稿光标处插入文字并展开辅助输入，不自动发送。有选区操作时 Ctrl/Cmd+C 复制，没有选区时 Ctrl+C 仍中断命令。终端持续输出、窗口重排或 TUI 重绘后，操作菜单仍保留选中时的文字；失效的选区高亮和手柄会收起。重新选择、点击别处、按 Escape 或粘贴到输入栏后关闭菜单。

Web 端可点击底部「添加文件」，也可将文件拖入辅助输入框；截图复制后，在辅助输入框或终端中按 Ctrl+V（macOS 为 Cmd+V）。手机和平板可通过「添加文件」选择照片或文件。每次最多选 10 个文件，单个不超过 25 MB。

文件上传到运行终端的主机，成功后将可读取的路径加入草稿，由你补充说明并发送；不会自动执行。直接粘贴到 Codex 终端的图片会在支持的路径格式下转为图片附件。浏览器若不提供剪贴板图片数据，请使用文件选择器。上传目录位于服务端状态文件旁的 `uploads/`，不通过静态站点公开；文件会保留以供会话后续读取，暂不自动清理。

```powershell
npm install
npm run dev
```

## 构建 Windows exe

```powershell
npm run build
```

构建完成后，可执行文件位于：

```text
src-tauri/target/release/code-terminal.exe
```

如果需要生成安装包：

```powershell
npm run bundle
```

Windows MSI 打包会下载 WiX 工具链，网络较慢时可能需要重试。

## 构建 macOS dmg

```bash
npm run bundle:mac
```

构建完成后，产物位于：

```text
src-tauri/target/release/bundle/macos/Code Terminal.app
src-tauri/target/release/bundle/dmg/Code Terminal_0.1.0_aarch64.dmg
```

默认产物是 Apple Silicon（aarch64）。如果需要同时兼容 Intel 芯片，先安装交叉编译目标再打通用包：

```bash
rustup target add x86_64-apple-darwin
npm run bundle:mac:universal
```

说明：

- 当前产物没有签名和 notarization，双击时系统会提示「无法验证开发者」，需要右键点击应用选择「打开」。
- 需要正式签名时，准备好 Apple 开发者证书后设置 `APPLE_SIGNING_IDENTITY`、`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`，需要公证时再补充 `APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`，然后重新执行 `npm run bundle:mac`。
- macOS 打包需要 `icons/icon.icns` 和 `icons/icon.png`，仓库已经提供；替换图标时它们要和 `icons/icon.ico` 一起更新。

## Linux 服务器和手机访问

会话标题在标签和瓦片顶部显示「项目名 · 会话名称」，没有名称时保留原项目名/序号。Codex 默认窗口标题与 `/rename 新名称` 会自动同步到对应终端；恢复历史时先显示所选历史的名称。项目名始终保留，长名称分别省略并可悬停查看。若 Codex 禁用了窗口标题或自定义了 `/title` 布局，则按程序报告的标题显示，无法从任意标题反推完整会话名称。

`pwsh.exe`、`powershell.exe` 等 Shell 标题不会作为自动会话名显示，也不会覆盖已知名称。从左侧恢复历史后，若 Codex 只上报项目名，会保留所选历史名称；收到实际会话名后改为跟随实时标题。手动启动且未上报名称的会话仍显示项目名/序号。同一终端内切换未命名会话时，若程序上报的项目标题完全相同，Web 无法识别会话变化；可从左侧恢复目标历史，或使用 `/rename`、`/tab-name` 明确名称。

在底部辅助输入栏输入 `/tab-name 新名称` 可设置工作台显示别名（最多 240 字符），该指令不会发送给终端；`/tab-name --auto` 恢复自动名称。别名优先于自动名称，并在本浏览器重新打开同一后台终端时恢复。Codex 的 `/rename` 与 `/title` 仍原样发送，真实会话名称由 Codex 保存。

左侧 resume 历史会按项目 ID 和目录缓存在本浏览器，切换项目、展开列表和刷新页面时直接显示已加载记录。底部「刷新项目」会重新读取历史，并按会话 ID 更新/合并，保留以前加载过但本次不在最近列表中的会话；同名不同 ID 的会话不会合并。刷新失败时旧记录保持可用，可点击错误提示重试。缓存的是已经加载过的历史，不代表服务器上尚未加载的全部历史；清理浏览器站点数据会清除本地缓存。

更新部署时，需要同步构建前端和服务器二进制，并确认服务使用新的 `dist` 目录和二进制。HTML 入口会要求浏览器重新校验缓存；已经打开的标签页仍需刷新才能加载新版。若旧版本更新后终端停在命令行，可先硬刷新。生产构建保留标识符和空白压缩，关闭会破坏 xterm 模式查询的语法压缩；不要只验证开发模式下的终端启动。

服务器模式会在 Linux/Windows/macOS 上启动一个 HTTP Web UI，并在服务器本机创建真实 PTY。手机访问这个页面时，输入会发送到服务器上的 shell，适合用手机临时操作服务器里的 Codex 或其他 TUI。

本机调试：

```bash
npm run server
```

默认监听 `127.0.0.1:8787`，浏览器打开：

```text
http://127.0.0.1:8787/
```

给局域网或手机访问时，需要显式设置 token：

```bash
CODE_TERMINAL_ADDR=0.0.0.0:8787 CODE_TERMINAL_TOKEN=change-this-token npm run server
```

手机打开：

```text
https://<server-host>/#token=change-this-token
```

`#token` 不会随初始页面请求发送到服务器，页面加载后会立即从地址栏移除，并仅在当前标签页会话中保留。远程访问应在服务端前配置 HTTPS 反向代理；直接使用非回环 HTTP 时，token、终端输入和输出都可能被网络中间节点读取。

也可以先构建服务器二进制：

```bash
npm run build:server
```

构建产物位于：

```text
src-tauri/target/release/code-terminal-server
```

可选环境变量：

- `CODE_TERMINAL_ADDR`：监听地址，默认 `127.0.0.1:8787`。
- `CODE_TERMINAL_TOKEN`：外部访问 token；只要监听地址不是本机回环地址就必须设置。
- `CODE_TERMINAL_STATE`：项目列表和主题配置文件路径，默认 `$HOME/.code-terminal/workbench-state.json`。
- `CODE_TERMINAL_DIST`：前端静态文件目录，默认当前工作目录下的 `dist`。

不要把未加 HTTPS 的服务直接暴露到公网；手机远程访问建议放在 Tailscale、ZeroTier、VPN 或带 HTTPS 的反向代理后面。

## GitHub Release

仓库包含 GitHub Actions 工作流：

- `CI`：在 push 和 pull request 时检查前端构建，并在 Windows、macOS、Linux 上运行 Rust backend `cargo check`。
- `Release`：手动触发或推送 `app-v*` tag 时构建 Windows 安装产物、便携 exe 和 macOS app/dmg，并发布为 prerelease。

发布一个版本可以这样操作：

```powershell
git tag app-v0.1.0
git push origin app-v0.1.0
```

如果当前网络需要代理：

```powershell
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin app-v0.1.0
```

## 技术栈

- **Desktop**：Tauri 2
- **Frontend**：React 18、TypeScript、Vite
- **Terminal UI**：xterm.js
- **Backend**：Rust、portable-pty
- **Platform focus**：Windows 优先，macOS 已可打包发布，Linux 持续验证

## 本地终端行为

- Windows 默认启动 `powershell.exe -NoLogo`
- macOS/Linux 默认使用 `$SHELL`，没有 `$SHELL` 时使用 `/bin/sh`
- 选中项目后，终端工作目录就是该项目目录；再次点击已打开项目会切回已有终端
- 切换单 Tab / 多瓦片或拖拽调整布局时，隐藏的终端会继续运行
- 关闭应用时，会清理由工作台创建的终端进程

## 还在继续做

- 更完善的发布包和 GitHub Release
- 更多终端主题预设
- 更细的项目分组、启动配置和布局持久化
- 更稳定的跨平台行为验证

## License

当前暂未添加开源许可证；使用或二次开发前，请先联系作者确认授权方式。
