# 你画我猜 · Draw & Guess

基于 **Deno + Hono + 原生前端 + WebSocket** 的多人实时"你画我猜"小游戏。

- 🚪 登录即进入：登录后**自动进入唯一房间**，无需创建 / 加入
- 🔄 轮流作画：上一位画手被猜中后，**按进入房间顺序自动轮换**到下一位玩家出题作画
- 🎨 游戏：当前画手在画板上作画，其他玩家在输入框中猜测答案
- 💬 实时聊天弹幕 + 🔴 实时同步画板
- 🏆 积分排行榜（全部玩家计入，轮到谁作画谁本回合不出猜）
- ❤️ 心跳保活：超过 10 分钟无心跳的连接会被自动清理，释放其昵称
- 🌙 支持浅色 / 深色模式（跟随系统）

## 运行

需要安装 [Deno](https://deno.com/)（≥ 1.40）。

```bash
cd deno-demo
deno task start      # 启动
deno task dev        # 开发模式，文件变化自动重启
```

启动后终端会打印本机局域网地址：

```
本机局域网IP地址：
  http://192.168.x.x:8000
```

- <http://localhost:8000/> — 登录 / 游戏（单页，登录后即进入房间）

## 快速试玩

1. 浏览器 A：打开 `http://localhost:8000`，输入昵称"小明"，点击「进入游戏」→ 自动进入唯一房间，小明成为第一位画手
2. 浏览器 B：打开同一地址，输入昵称"小红"，点击「进入游戏」→ 自动进入同一房间
3. 画手（浏览器 A）在答案输入框输入一个词，点击「确认并开启画板」，然后在画板上作画
4. 玩家（浏览器 B）在聊天输入框输入猜测的词回车；猜对则 +1 分，本轮结束，并**自动轮换到小红**成为下一位画手
5. 小红设置新答案、开启画板，开始新一轮；如此按进入顺序轮流下去

## 目录结构

```
deno-demo/
├── main.tsx              # 后端：路由 + WebSocket 状态机
├── deno.json             # Deno 项目配置（依赖 / tasks / 部署）
├── README.md             # 项目说明
├── CODE-WIKI.md          # 完整架构 / 模块 / 协议文档
└── static/
    ├── css/home.css      # 全站样式
    ├── js/home.js        # 首页 + 游戏页前端逻辑
    └── img/head_img.jpg  # favicon
```

详见 [CODE-WIKI.md](./CODE-WIKI.md)。

## 部署到 Deno Deploy

推送代码到 Git 仓库后，在 [dash.deno.com](https://dash.deno.com) 配置项目 **nhwc** 的 Git 自动部署，入口文件 `main.tsx`。

部署后访问：<https://nhwc.nhwc.deno.dev>

Deno Deploy 需要的权限已在启动命令 `deno run --allow-net --allow-sys --allow-read main.tsx` 中声明，在部署时会自动转换使用。

---

© 2025 Apollo & Nahida
