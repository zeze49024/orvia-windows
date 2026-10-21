# Orvia Windows 工作约定

- 技术栈为 React、TypeScript、Vite、shadcn/ui、Tailwind CSS、Tauri 2 与 SQLite；界面遵循已确认设计与 A v2 纯图形标志。
- 用户确认版本号后，完成实现与验证，生成安装包或 Release 文件，并推送源码、版本标签及 GitHub Release 资产；不能仅提交版本号就宣称发布完成。
- 更新日志必须使用用户提供或确认的文案。本次 v0.1.0-beta1 的原文为“完成Orvia应用初版构建”。
- 内部 `Orvia_DepDocs` 不上传；不提交用户知识库、备份、凭据或构建缓存。安装包通过 GitHub Release 资产分发，不进入源码历史。
- 更新采用现有 Tauri 签名密钥；私钥在仓库外，不打印、不提交、不擅自重新生成。发布资产可用后再推进 `updates/windows/latest.json`，保证更新地址有效。
- 当前用户内容完全本地，无账号、云保存、云同步或遥测。网络仅用于用户主动检查和安装 GitHub 更新，不携带知识库内容。
- 改动后运行适用的测试与构建；如未执行原生安装或跨版本升级，明确报告验证边界。
