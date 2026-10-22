# Orvia for Windows

Orvia 是完全本地运行的 Markdown 个人知识库。当前版本 **v0.1.0-beta7**。

采用 React、TypeScript、Vite、shadcn/ui、Tailwind CSS、Tauri 2 和 SQLite，沿用确认的黑白灰界面与 A v2 图形标志。
内置简体中文、繁体中文和英文，无需账号，不接入云存储或同步，不上传文档内容。

## 使用

从本仓库 GitHub Releases 下载 Windows x64 安装程序。首次启动创建本地工作空间；可新建文档或添加入门笔记。
支持知识库管理、Markdown 实时编辑、源码编辑与阅读预览、标签、星标、搜索、最近打开、自动保存、回收与恢复。
支持本地 Markdown、图片、DOCX 和文字型 PDF 导入；完整备份导出与校验恢复、单篇独立 Markdown 文件导出（本地图片嵌入文件，并支持重新导入）。
支持选择 Markdown 文件夹，导入目录内文档及相对路径引用的图片。文本支持 UTF-8 和带 BOM 的 UTF-16；无法识别的编码会提示重新保存。源码支持撤销与重做；超过 20 万字符的长文档使用源码模式。
编辑器“文档选项”提供移动知识库、标签与历史版本恢复。自动历史每篇最多保留 20 个检查点和 20 MB，恢复前保留当前内容。
顶栏衣服图标可切换“浅色主题”与“深色主题”，重启后保留选择。
设置 → 版本与更新，可从 GitHub 检查更新；确认后下载，并校验签名后安装。

本 Beta 的 PDF 导入仅提取文字，不提取图片或执行 OCR；不支持旧版 `.doc`、复杂版式无损转换和云功能。
本地数据没有云端副本，请定期导出完整备份到其他介质。更新签名不等同于 Windows 发布者数字证书。

## 开发

```powershell
npm ci
npm run desktop
```

`npm test`、`npm run test:native`、`npm run build` 验证源码；`npm run package` 构建签名安装包。
原生构建需要 Rust MSVC、Visual Studio C++ Build Tools、Windows SDK 和 WebView2。

[开发与发布说明](docs/DEVELOPMENT.md) · [更新日志](CHANGELOG.md) · [第三方组件](docs/THIRD_PARTY_NOTICES.md)

Web、Android、iOS 维护独立仓库。内部技术方案不随本仓库上传。

## 授权

Copyright (c) 2026 zeze49024。

采用自定义 [Orvia 非商业源码可用许可证 1.0](LICENSE)，标识为 `LicenseRef-Orvia-Noncommercial-1.0`。
这是源码可用项目，不使用 OSI 开源许可证。

- 个人非商业自用可以修改，且无需公开私人修改。
- 非个人自用的修改与二次开发必须公开对应源码，并沿用本许可证。
- 商用，包括闭源商业衍生版本，必须事先取得权利人的单独书面授权；公开源码不能替代商用授权。

完整权利义务以 LICENSE 为准。商业授权请通过 [维护者 GitHub](https://github.com/zeze49024) 联系，并在使用前完成书面授权。
第三方依赖适用各自许可证，本许可证不重新授权第三方代码。
