# ☕ Yuki自习室 (Yuki Study Room)

<p align="center">
  <img src="./assets/generated/cozy-night-study.png" alt="Yuki自习室" width="800" style="border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);" />
</p>

<p align="center">
  <strong>专属于你的沉浸式英语学习空间</strong><br>
  结合主动回忆（Active Recall）· 艾宾浩斯记忆追踪 · 4500+离线词典 · 原生AI伴学助教 · 云端无感同步
</p>

<p align="center">
  <a href="https://suki0201.cc.cd/"><img src="https://img.shields.io/badge/Live_Demo-suki0201.cc.cd-0a84ff?style=flat-square&logo=cloudflare" alt="Online Demo"></a>
  <a href="https://github.com/siki060201/Yuki-"><img src="https://img.shields.io/badge/GitHub-Yuki--Room-white?style=flat-square&logo=github" alt="GitHub Repo"></a>
  <img src="https://img.shields.io/badge/Platform-Web%20%7C%20PWA%20Ready-success?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/License-MIT-orange?style=flat-square" alt="License">
</p>

---

## 🌐 线上自习室（立即体验）

- **官方独立域名**：👉 [**https://suki0201.cc.cd/**](https://suki0201.cc.cd/)
- **备用边缘节点**：[https://lexora-ai-reader.siki060201.workers.dev](https://lexora-ai-reader.siki060201.workers.dev)

> 💡 **无需安装**：开箱即用，支持桌面端与移动端浏览器全屏沉浸体验。

---

## 📖 关于 Yuki自习室

**Yuki自习室** 是一款专为深度英语学习者倾力打造的现代化全功能自习空间。

我们厌倦了繁琐广告、机械重复刷词和冷冰冰的背词软件。Yuki自习室推崇**“在宁静中专注，在语境中内化”**，将科学的学习心法融入深色毛玻璃的优雅氛围中：

- **主动回忆（Active Recall）**：从“看似认得”到“真正掌握”，通过即时默想与快速自我检验，强化学神经连接；
- **艾宾浩斯复盘（Spaced Repetition）**：智能追踪昨日学习词汇与薄弱点，科学规划复习节点；
- **AI 伴读与问答（AI Companion）**：内置原生单页 AI 学习助手，随时拆解长难句、推敲语法点、生成地道语境短文；
- **自习室声景（Ambient Audio）**：窗外细雨与海浪白噪音伴随深度番茄钟，让你一秒沉浸心流状态。

---

## ✨ 核心特性一览

### 1. 🎯 主动回忆高效背词
- 盲打拼写、心算默读自测与双向键盘快捷键（空格看释义，上下左右快速标记熟练度）；
- 彻底摒弃被动的“眼熟自欺欺人”，每一次回忆都形成深度长期记忆。

### 2. 📚 4500+ 本地权威离线词典
- 内置高频核心词库，涵盖 CET-4 / 考研 / 雅思核心高频词汇；
- 原生国际音标（IPA）与高质量真人发音引擎，断网环境亦可离线使用。

### 3. 🤖 原生嵌入式 AI 对话助教
- **单页原生架构**：同屏平滑秒切，拒绝弹窗或外跳跳转；
- **深度研学对话**：支持多会话管理、中英对照、长难句语法剖析、真题语境造句；
- **用户独立隔离**：零硬编码 Key，每位学习者配置自己的专属 API Key，隐私与额度绝对安全；
- **AI 语境阅读短文**：输入几个正在记忆的重点生词，AI 即可为你定制创作一篇生动严密的地道短文。

### 4. ☁️ 极简云端同步（Cloudflare Workers + KV）
- 纯粹正常的账号密码一键注册与登录，告别繁冗验证码与绑定骚扰；
- 基于密码 SHA-256 边缘加密，跨设备多端（电脑 / 平板 / 手机）自动无感同步背词进度。

### 5. 🎨 macOS Vibrancy 毛玻璃设计哲学
- 精心调配的 1px 精准发光边框、层级明暗对比与亚克力质感；
- 支持温润日光（Daylight）与深邃黑金（Midnight）多款沉浸自习室主题。

---

## 🛠️ 本地运行与部署

### 1. 本地免安装运行
本项目为纯粹原生现代 Web 应用，无需复杂的打包构建环境：
```bash
# 克隆仓库
git clone https://github.com/siki060201/Yuki-.git
cd Yuki-

# 使用任意静态服务器启动
npx serve .
# 或使用 Python
python -m http.server 8080
```
打开浏览器访问 `http://localhost:8080` 即可使用。

### 2. 一键部署至 Cloudflare Workers
项目内置了完整的 Cloudflare 边缘计算与 KV 云同步后端：
```bash
# 1. 安装依赖
npm install

# 2. 部署到 Cloudflare
npm run deploy
```

---

## 🔐 隐私与安全承诺

- **无隐私窥探**：学习数据与复习进度仅保存在用户本地或您登录的专属云端数据库；
- **密钥安全**：AI 接口密钥仅保存在用户当前浏览器本地缓存（LocalStorage）中，仅向大模型服务商发起直连调用，绝不在任何第三方服务器转存。

---

## 📄 开源许可证 (License)

本项目基于 [MIT License](LICENSE) 协议开源。你可以自由地学习、使用、二次修改与部署属于你自己的自习室！
