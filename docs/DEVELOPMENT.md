# 开发与发布

版本：v0.1.0-beta1。确认的更新日志：完成Orvia应用初版构建。

## 启动

安装 Node.js 24+、Rust MSVC 工具链、Visual Studio C++ Build Tools 与 Windows SDK，以及 WebView2。

```powershell
npm ci
npm run desktop
```

`npm run dev` 仅启动浏览器预览，使用独立 IndexedDB 数据库，不读写桌面 SQLite。
`npm test` 检查数据约束、备份完整性和并发写入；`npm run test:native` 检查 SQLite 事务。
`npm run build` 编译前端。`npm run package` 构建 NSIS 安装包及更新签名。

## 数据

Windows 数据目录为 `%LOCALAPPDATA%/space.zeze49024.orvia`，使用 `orvia.sqlite3` 与 `assets/`。
正文保存在 SQLite 中；图像按 SHA-256 存为本地文件。数据库采用 WAL 和 FULL 同步。
保存使用工作空间版本比较与事务；冲突拒绝覆盖并保留未保存草稿。单实例启动防止同一应用多进程覆盖。
关闭前等待保存；写入失败时不会假报成功。请定期导出完整备份到其他介质。

备份为 `.orvia` ZIP：`manifest.json`、`workspace.json` 和 `assets/<sha256>`；导入校验格式版本、哈希、引用、大小与压缩包路径，然后复制为独立知识库，原有数据和设置保留。
本版有 128 MB 压缩包、256 MB 解压总量与单个文件 32 MB 的恢复上限；图片单个 20 MB，导入源文件单个 25 MB，PDF 200 页。
本版不实现自动历史快照或后台周期备份。取消或失败的图片导入可能留下未引用的应用内资产，不会删除用户原文件。

## 导入与安全边界

支持 Markdown、文本、PNG/JPEG/WebP/GIF、DOCX（正文与内嵌图片）、文字型 PDF（仅正文）。
PDF 图片提取、扫描 PDF OCR、旧 `.doc`、复杂版式无损还原不在本次 Beta 支持范围。
所有转换本地执行；第三方字体、PDF CMaps 与 WASM 随包内置，不加载 CDN。
Markdown 不执行 HTML，不自动下载远程图片，不自动打开外链。
当前没有账号、云端保存、同步或遥测；只预留禁用能力契约。

## GitHub 更新

设置 → 版本与更新 → 检查更新。仅主动检查时访问更新清单，发现更新后由用户确认下载与安装。
清单：`https://raw.githubusercontent.com/zeze49024/orvia-windows/main/updates/windows/latest.json`。
安装包位于同仓库 GitHub Releases；支持 Beta 版本，不依赖 GitHub 的 stable-only `/releases/latest` 路径。
Tauri updater 校验 Ed25519 签名后才运行安装包。更新签名不等同于 Windows Authenticode 发布者证书。

本机签名私钥存放于 `%USERPROFILE%/.orvia/signing/windows-updater.key`，不在仓库中。
请离线备份并妥善保管；后续更新必须使用相同私钥。公钥已写入 `src-tauri/tauri.conf.json`。
其他构建环境通过 `TAURI_SIGNING_PRIVATE_KEY` 指定私钥路径，密码通过 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 环境变量提供，禁止提交私钥或密码。

发布步骤：确认版本与更新日志 → 测试 → 构建安装包及 `.sig` → 生成更新清单及 SHA-256 → 提交源码 → 推送版本标签 → 创建 GitHub prerelease 并上传安装包、签名、清单、校验文件 → 验证资产可用后提交并推送更新清单。
不要把本地内部技术方案、数据库、备份、凭据、构建缓存或安装包二进制提交到源码历史。

## 语言资源

三语资源位于 `src/i18n/locales/`，`registry.ts` 统一注册语言，`index.ts` 负责取词和格式化。语言切换只更新界面，不改写用户文档。
未来增加语言时扩展资源注册；业务组件通过稳定消息键访问。
