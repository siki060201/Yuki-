# 开源致谢与版权声明 (Credits & Attribution)

本项目在开发过程中严格遵守开源社区精神与国际合规规范，秉承尊重原作者知识产权与开源分享的原则。特别对本项目中所借鉴、学习与集成的优秀开源项目及组件在此予以正式致谢与声明。

---

## 🌟 核心设计启发与架构致谢：AI 智能助学对话模块

- **项目名称**：AI-Chat
- **项目仓库**：[https://github.com/STA1N156/AI-Chat](https://github.com/STA1N156/AI-Chat)
- **原始作者**：[STA1N (STA1N156)](https://github.com/STA1N156)
- **提交依据**：Commit [`b0171f4af654da54d95c814b1134dd69d5337667`](https://github.com/STA1N156/AI-Chat/commit/b0171f4af654da54d95c814b1134dd69d5337667)
- **致谢说明**：
  - 本项目内置的单页 AI 智能助学对话工作台（`#view-chat` 及 `js/chat.js`）在**多会话历史管理、流式对话管道、Markdown 渲染交互及快捷预设卡片**的设计上，深度学习并吸收了原作者 **STA1N156** 的优秀开源设计思想。
  - 为给学习者提供最极致流畅的英语学习体验，我们在遵循原项目核心交互逻辑的基础上，进行了主应用 SPA 单页原生重构，使其与背词、阅读、日历等模块实现零跳转、零延迟的同屏无感切换。
  - 同时，本项目严格执行**多用户密钥独立隔离机制**，绝不在源码中硬编码任何共享密钥，保障每位使用者的个人账户与资产安全。
  - 特别感谢原作者 **STA1N156** 为开源社区贡献的高水准作品！本项目在任何公开场合与 GitHub 仓库中均坚决标明原作者的灵感贡献与版权。

---

## 📦 其他开源依赖与第三方库致谢

本项目还使用并受益于以下杰出的开源项目与库：

| 组件 / 依赖项 | 用途说明 | 开源协议 | 项目地址 / 来源 |
| :--- | :--- | :--- | :--- |
| **Lucide Icons** | 全局 UI 现代化线性图标库 | ISC License | [lucide.dev](https://lucide.dev/) |
| **Marked.js** | Markdown 解析与实时渲染器 | MIT License | [marked.js.org](https://github.com/markedjs/marked) |
| **Highlight.js** | 代码高亮与格式化显示 | BSD-3-Clause | [highlightjs.org](https://highlightjs.org/) |
| **Mammoth.js** | Word (.docx) 文档解析提取 | FreeBSD License | [github.com/mwilliamson/mammoth.js](https://github.com/mwilliamson/mammoth.js) |
| **PDF.js** | PDF 文档解析与渲染支持 | Apache-2.0 | [mozilla.github.io/pdf.js](https://mozilla.github.io/pdf.js/) |
| **SheetJS (xlsx)** | Excel 表格数据解析与处理 | Apache-2.0 | [sheetjs.com](https://sheetjs.com/) |
| **LameJS** | 纯前端 MP3 语音录音与音频编码 | LGPL-3.0 | [github.com/zhuker/lamejs](https://github.com/zhuker/lamejs) |
| **jsdiff** | 文本与代码差异对比显示 | BSD-3-Clause | [github.com/kpdecker/jsdiff](https://github.com/kpdecker/jsdiff) |

---

## 📜 声明与免责

1. 本项目所引用的第三方开源代码与概念设计，其版权及所有知识产权均归原作者所有。
2. 若任何原作者对于集成或呈现形式有进一步建议，请通过 GitHub Issue 或邮箱联系，我们将在第一时间响应配合。
