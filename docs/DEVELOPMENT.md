# 开发与发布

版本：v0.1.0-beta6。确认的更新日志：完善图文导入导出与文档管理，新增增量保存和历史恢复，优化编辑与首页体验，重构代码并加强安装升级验证。

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
本版有 128 MB 压缩包、256 MB 解压总量与单个文件 32 MB 的恢复上限；图片单个 20 MB，普通导入源文件单个 25 MB，嵌图 Markdown 单个 128 MB（解析后正文最多 5,000,000 字符，图片单个 20 MB、独立图片总量最多 96 MB），PDF 200 页。
本版自动历史每篇最多 20 个、20 MB，每分钟一个检查点；恢复前强制保留当前内容。完整备份包含当前文档与图片，不包含历史列表；不实现后台周期备份。取消或失败的图片导入可能留下未引用的应用内资产，不会删除用户原文件。

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

## Beta2 实时编辑

默认使用 Tiptap 本地富文本编辑器（[官方 Markdown 接口](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage)），直接编辑渲染后的标题、加粗、斜体、列表、任务、引用、代码、表格与本地图片。Markdown 输入快捷方式、Ctrl+B / Ctrl+I、Ctrl+Z / Ctrl+Shift+Z 与工具栏操作可用；纯文本 Markdown 粘贴在支持的语法范围内自动排版，忽略剪贴板 HTML，防止外部图片请求。

底层正文仍为 Markdown，沿用原 SQLite、备份与更新机制，无数据库迁移。打开文档不触发正文重写。原文与编辑器序列化结果通过 Markdown 语义树比较：HTML、脚注或其他无法等价转换的内容自动保留源码编辑；可在源码和实时编辑间切换。编辑后允许规范化列表标记、表格对齐和空白排版。此版并非完整复刻 Typora 的全部语法与交互。

图标由原 SVG 生成透明 PNG 与 16/24/32/48/64/128/256 像素 ICO，LOGO 约占画布 82%，应用内同步缩小。品牌原 SVG 保留不改。

## Beta3 Windows 图标

图标资产在 `scripts/icon-assets.mjs` 统一生成：16–128px 使用含 alpha 与 AND 透明遮罩的 32 位 BGRA DIB，256px 使用透明 PNG，512px PNG 继续供其他图标读取。resvg 的预乘 RGBA 像素先还原为直通 alpha，避免半透明边缘变暗。运行窗口显式使用生成的 256px RGBA 图标，安装器通过 SHChangeNotify 通知 Shell 更新缓存，不删除缓存文件或重启 Explorer。

`node scripts/verify-exe-icons.mjs` 检查实际可执行文件的 7 个 RT_ICON 资源与预期像素资产一致，并检查显式窗口图标已嵌入。

诊断时已读取用户已安装 Beta2 的 PE 图标，7 档资源均有透明 alpha；截图中任务栏按钮外层圆角浅色底板属于 Windows 的运行/选中状态效果。本版不承诺去掉系统自身的按钮底板，也不修改全局任务栏外观。

参考：[Microsoft 图标资源说明](https://learn.microsoft.com/en-us/windows/win32/menurc/about-icons)、[SHChangeNotify](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shchangenotify)。

## Beta4 编辑界面

移除编辑区域操作提示、左下角本地存储卡片；右侧仅保留文档大纲与无标题时的空状态，不再显示知识库选择、格式、保存状态、标签或隐私提示。保存状态仍显示在上方工具栏。

标题菜单使用 Radix/shadcn 风格组件，支持正文、H1–H6；富文本转换实际节点，源码模式替换整行已有标题标记。大纲由 Markdown 语法树生成，包含 Setext 标题、忽略代码块中的伪标题，并按层级缩进；点击可定位正文标题。

## Beta5 主题与导出

保留既有颜色为“浅色主题”，新增“深色主题”。旧 CSS 的颜色使用语义变量与原值回退，浅色切换时清除深色覆盖，保留原先每处配色。顶栏“备份与恢复”旁的衣服图标打开主题菜单，覆盖页面、编辑器、菜单、弹窗及深色专用品牌 SVG，不对用户图片应用反色滤镜。

`src/core/themes.ts` 导出 ThemeDefinition、themeTokens、themeRegistry、registerTheme 和 resolveTheme。新增主题在 React 挂载前调用 registerTheme，提供稳定 ID、三语名称、light/dark 基底、颜色变量及预览颜色；菜单自动发现，未覆盖的变量继承对应基底。颜色限制为十六进制值，避免注入外部资源。此版不提供下载或加载不可信主题脚本。

主题 ID 保存于 SQLite 工作空间设置 `settings.theme`，旧数据通过默认值 light 兼容，未知未来 ID 暂以浅色显示且不破坏其设置。localStorage 只缓存主题 ID，用于启动时绘制主题；SQLite 为权威来源，备份恢复沿用当前用户的主题设置。

文档名称改为小字号的“文件名”输入栏，不作为正文 H1 或导出内容。所有 Markdown 导出入口均导出选定文档的单个 `.md`，不创建目录或 ZIP，也不插入文件名作为额外标题。Markdown 语法树中的本地图片引用转换为 data URI 嵌入，代码里的资产字面量不变；部分第三方 Markdown 阅读器可能限制 data URI 图片。完整 `.orvia` 备份格式保留，用于工作空间恢复。

## Beta6 质量与验收

`npm run test:e2e` 运行三个端到端工作流；首次运行需 `npx playwright install chromium`。安装升级验证由 `.github/workflows/installer-smoke.yml` 在一次性 Windows runner 中执行，执行 beta5 安装与 beta6 覆盖升级，并通过真实 WebView2 → IPC → SQLite 验证数据保留。不得将此脚本用于用户的日常安装。

用于隔离调试时，编译后的程序支持 `--validation-root <绝对目录>`，目录必须预先含 `.orvia-validation` 文件；同时将进程环境 `WEBVIEW2_USER_DATA_FOLDER` 指向该目录下的独立 WebView2 文件夹。该模式使用独立数据库且不加入日常实例锁，普通启动行为不变。测试需要调试端口时仅在该测试进程设置 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9226`；正式启动不配置调试端口。

界面协调位于 `src/app.tsx`，编辑工作区、首页、设置和文档选项位于独立组件；异步作业生命周期由 `src/hooks/use-job-runner.ts` 管理。`src/core/delta.ts` 生成差异，`src-tauri/src/persistence.rs` 执行事务与有界历史检查点。现有数据库只新增历史表和索引，不重写既有文档。新导入的 data URI 图片经过格式识别与哈希保存后才显示。

详见 [Beta6 验收记录](BETA6-VALIDATION.md)。

## RC1 批量管理与设置

`src/core/batch.tsx` 提供批量不可变修改、重名处理和 Markdown/ZIP/HTML 导出；独立文件原生导出仅写入用户通过系统对话框选择的目录，以排他创建避免覆盖。单次导出总量限制 128 MiB。HTML 不执行原始 HTML 和脚本，不自动请求远程图片。

置顶字段默认 false，存储在既有文档 JSON；无需重建 SQLite 表。设置页保留编辑器挂载状态，返回后保持撤销历史。安装升级工作流验证 beta8 → rc1，覆盖真实右键多选/置顶落盘及独立设置页。详见 [RC1 验证记录](RC1-VALIDATION.md)。
