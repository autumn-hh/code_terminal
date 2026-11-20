# Repository Instructions

- 每次修改完成后，运行对应检查或构建，并提交一把 git。
- 每次修改完成后，都需要重新打包 Windows exe。
- 在 macOS 开发机上无法交叉构建 Windows exe 时，用 `npm run bundle:mac` 验证桌面包，并在提交说明里注明未重打 Windows exe 的原因。
- macOS 打包依赖 `src-tauri/icons/icon.icns` 和 `src-tauri/icons/icon.png`，替换图标时必须和 `icon.ico` 一起更新。
- `tauri.macos.conf.json` 的 `app.windows` 会整段替换基础窗口配置。改窗口尺寸、标题、最小尺寸时，同步更新该文件，并保留 `decorations: true`、`titleBarStyle: "Overlay"`、`hiddenTitle: true`。
- 若 `npm run bundle:mac` 在链接阶段报 `xcrun: error: unable to lookup item 'Path' in SDK 'macosx'` / `Failed to locate 'clang'`，说明 Xcode 的 `xcrun` 被残留的 `/Library/Apple/System/Library/PrivateFrameworks/Mercury.framework` 弄坏了（符号 `_XPCTypeBool` 缺失，且该目录受 SIP 保护不可删）。不要去动系统目录，改用 `npm run bundle:mac:clt`（等价命令：`DEVELOPER_DIR=/Library/Developer/CommandLineTools tauri build --bundles app,dmg`）。
- 提交前说明修改了哪些文件、为什么修改，以及实际验证命令和结果。
- 开始处理仓库任务时，先阅读 `docs/agent-harness/README.md`，按其中的 rules / memory / skills / subagents 顺序加载需要的上下文。
- `docs/agent-harness/memory.yaml` 用于记录稳定项目记忆和部署变量；严禁写入服务器密码、token、密钥、证书或 `.env` 明文。

## 终端输入交互约束

- 底部对话输入框必须保持 `Enter` 发送消息，不允许回退成普通换行。
- 只有 `Shift+Enter` 才能在对话输入框内插入换行。
- 当对话输入框为空时，`Enter` 应该把回车发送给当前 TUI/终端，用于确认 `codex resume` 等 TUI 选择，而不是在输入框中换行。
- 当对话输入框为空时，方向键、PageUp/PageDown、Home/End 应继续转发给当前 TUI/终端。
- 对话输入框向 Codex TUI 发送非空文本时，应先以 bracketed paste 写入文本，再延迟发送一次回车触发 TUI 提交；不要把粘贴结束和回车合并成同一批写入，否则 Codex 会把回车当成输入框换行。
- 窗口固定使用终端视图，不再提供“终端 / 对话”切换入口；旧的对话视图偏好不得影响终端显示。
- 保留底部辅助输入框、原始 TUI 输出和灰色/暗色思考过程。

## 移动端界面约束

- 手机访问界面空间有限，顶部功能/操作栏必须支持隐藏或收纳，尽量把终端可用区域放大。
- 移动端操作栏不得挤压调色、主题、字号、行距等外观设置区域；这些控件应独立换行、横向滚动或折叠，避免互相抢宽度。
