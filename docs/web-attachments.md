# Web 文件与图片上传

底部「添加文件」在辅助输入收起时也可见。文件选择、多选、拖入输入框、粘贴图片统一上传；每次最多 10 个文件，单个上限 25 MiB。上传过程中保留输入，禁用发送，完成后添加路径，由用户确认发送。失败保留已有草稿及成功路径，可重新选择同一文件重试。

待发送附件显示为文件名条目，右侧「×」可从本次消息移除，并同步删除草稿中的路径，保留其他附件和文字。计数根据草稿实际保留的路径计算；手动清空、Esc、发送或 Tab 转交后同步清除，不再保留过期的“已添加”提示。收起辅助输入仍可移除附件，长文件名省略显示并保留完整可访问名称。此操作只移除本次消息引用，不删除服务器文件或已经进入 TUI 的附件。

直接在终端粘贴图片只向发起粘贴的原会话写入路径，不自动回车。无需引号的安全路径保持原样，Codex 0.165.0 可据此生成 `[Image #1]`；无条件加引号会变成普通文字。其他 TUI 是否把路径识别为附件由该程序决定。若手机浏览器没有向 paste 事件提供图片数据，使用文件选择器。

## 实现与边界

- `src/TerminalPane.tsx`、`src/styles.css`：文件入口、进度、错误及触屏布局。
- `src/tauriRuntime.ts`、`src/clipboardImages.ts`、`src/TerminalSessionView.tsx`：二进制上传、路径格式、原会话绑定。
- `src-tauri/src/attachments.rs`、`server.rs`、`lib.rs`：共用保存逻辑，Web 新增 Bearer 认证的 `POST /api/upload_attachment?name=...`，鉴权先于读取 body；仅该接口允许最多 25 MiB。桌面通过 `save_attachment` 保存。
- 每个文件使用独立 UUID 目录，文件名过滤分隔符和控制/命令字符、保留短扩展名，不接受客户端指定目的路径、不覆盖文件。Linux 目录/文件权限为 0700/0600。
- Web 存储在状态文件旁 `uploads/`，生产为 `/opt/code-terminal-state/uploads/`，不在公开静态目录中；桌面使用临时目录。暂不自动清理，以便后续会话读取。
- Web 直接上传 File 二进制，替代图片 JSON 数字数组膨胀与默认请求上限问题；不新增依赖。

## 验证（2026-10-29）

- 修改前 `npx tsc --noEmit` 通过。`npm run test:frontend` 40/40，`cargo test --manifest-path src-tauri/Cargo.toml --bin code-terminal-server --no-default-features --locked` 11/11。
- `npm run build:frontend`、`npm run build` 均通过，重新生成 Windows exe；Docker `rust:1-bookworm` 按 Cargo.lock 构建 Linux release 成功。
- `python tests/terminalAttachments.py`：隔离真实服务端，匿名 401、3 MiB 字节一致、25 MiB 超限 413、文件名路径隔离、同名不覆盖、非公开存储，浏览器实际选择文件/Ctrl+V、保留草稿、PTY 读文件、真实 Codex 图片附件标记通过。
- `playwright-cli run-code --filename tests/terminalAttachments.browser.js`：多选、粘贴、拖入、异步草稿、禁止自动提交、同文件重试、大小限制、360/390 手机和 884/1180 平板及 1280 桌面通过。
- `playwright-cli run-code --filename tests/mobileInteractions.browser.js`：Enter/Shift+Enter、中文 IME、延迟粘贴回车、触摸滚动、折叠屏/平板/短视口及 22px 字体回归通过。
- 新鲜截图实际回读，长文件名换行/滚动，附件按钮不与收起按钮重叠；触屏为 Chromium 模拟，未覆盖真机 Safari。

14:29:26 CST 已更新正式前后端并重启 `code-terminal.service`，active/running、自动重启次数 0。前端 `index-EhcJg6FX.js` / `index-BadDtljx.css`，公网文件 hash 与本地一致；保留原状态与凭据。回退备份 `/opt/code-terminal/backup-attachments-20261029-142925`。独立 Linux 预发布验证大文件和权限通过。

`python .playwright-cli/attachments-public.py` 公网实际上传 3 MiB、SHA-256 对照、PTY 读取、HTTP 页 Ctrl+V、真实 Codex 图片附件均通过；页面错误 0、匿名 401。首轮 Codex 标记等待超时，重新打开独立会话复测通过；未将上传成功单独视作图片识别成功。测试创建的会话和上传文件已清理。模型视觉理解和真机移动剪贴板未测试。

## 待发送附件移除修复

同日补充可移除文件名条目，修复清空输入后仍显示已添加的状态。`tests/terminalAttachments.browser.js` 新增移除指定文件并保留其他内容、收起后移除、移除后不发送该路径、手动清空/Esc/Tab/发送清除条目与计数，并在五种桌面/触屏尺寸检查长文件名和删除按钮边界。40 项前端单测、上述附件回归及 `tests/mobileInteractions.browser.js` 均通过，新截图已回读。

14:40 静态重新部署，前端 `index-zoWqPe86.js` / `index-DkMuwnPo.css`，6 个公网文件 hash 一致，服务 active、匿名 401/授权 200；未重启后端。`python .playwright-cli/attachment-removal-public.py` 实际上传两文件后，指定移除、保留其他附件与文字、清空无残留通过，页面错误 0；独立测试文件/会话已清理。

默认 release exe 正在运行而无法覆盖，保留用户窗口，使用 `$env:CARGO_TARGET_DIR="D:/freelife/opencode-workbench/src-tauri/target-bundle"; npm run build` 构建成功。最新文件位于 `src-tauri/target-bundle/release/code-terminal.exe`。
