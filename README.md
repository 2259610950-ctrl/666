# 🏫 UniCampus - 武汉科技大学校园社区

一个面向武汉科技大学学生的校园社区平台，集学术交流、二手交易、社交互动、职业内推、活动约伴等功能于一体。

## ✨ 功能特色

- 📚 **学术广场** — 学习资料分享、学术讨论、课程评价
- 🛒 **二手集市** — 校园二手物品交易，支持砍价、购买申请流程
- 💬 **社交动态** — 发帖、点赞、评论、社交互动
- 💼 **职业内推** — 校园招聘信息、内推机会
- 🎯 **活动约伴** — 社团活动、运动约伴
- 🔧 **校园服务** — 外卖跑腿、代拿快递等互助服务
- 🌤️ **校园天气** — 实时天气查询（青山区/黄家湖校区）
- 🔐 **管理后台** — 用户管理、数据统计、安全监控

## 🚀 部署

### 本地运行

```bash
npm install
npm start
```

访问 http://localhost:3000

### Render.com 部署

1. Fork 或 clone 本仓库
2. 在 [Render](https://render.com) 创建新的 Web Service
3. 连接 GitHub 仓库
4. 配置：
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Environment**: Node

## 🔑 默认账号

- 管理后台: `/admin.html`，默认密码: `unicampus2026`

## 📁 项目结构

```
├── index.html      # 首页
├── social.html     # 社交动态
├── market.html     # 二手集市
├── academic.html   # 学术广场
├── career.html     # 职业内推
├── activity.html   # 活动约伴
├── services.html   # 校园服务
├── profile.html    # 个人中心
├── auth.html       # 登录/注册
├── chat.html       # 聊天
├── admin.html      # 管理后台
├── core.js         # 核心逻辑
├── server.js       # 后端服务
├── app.js          # 应用入口
├── style.css       # 全局样式
└── data/db.json    # 数据存储
```

## 📄 License

MIT
