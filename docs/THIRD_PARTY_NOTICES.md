# 第三方组件

Orvia 自有代码使用仓库根目录的自定义许可证。第三方组件保留各自许可证，不能以项目许可证覆盖。

前端使用 React（MIT）、shadcn/ui（MIT）、Radix（MIT）、Lucide（ISC）、Tailwind CSS（MIT）、react-markdown / remark-gfm（MIT）、Mammoth（BSD-2-Clause）、Turndown（MIT）、PDF.js（Apache-2.0）、fflate（MIT）、Zod（MIT）。
原生部分使用 Tauri 及插件（MIT / Apache-2.0）、rusqlite（MIT）与 SQLite（公有领域）、sha2（MIT / Apache-2.0）。

构建时 `scripts/prepare-assets.mjs` 生成 `public/third-party-notices.txt`，随应用保留安装的 npm 组件及许可证正文。PDF 字体、CMaps 和 WASM 目录同时保留其自带许可证。

当前 `npm audit` 对 Mammoth 的 CLI 依赖链 argparse → sprintf-js 报告中等风险的格式化精度拒绝服务问题（GHSA-hp3w-g68c-fv3c）。应用只导入预构建 `mammoth.browser`，不调用 CLI 参数解析器；构建产物不包含该 CLI 依赖链。未通过降级到过时版本来隐藏报告。

Beta2 新增 Tiptap / ProseMirror 本地编辑组件（MIT），以及 unified / remark Markdown 解析组件（MIT）。完整依赖版本和授权文本随构建生成于应用的 third-party-notices.txt。
