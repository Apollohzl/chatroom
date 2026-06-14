# 你画我猜 · Draw & Guess

基于 **Deno + Hono + 原生前端 + WebSocket** 的多人实时"你画我猜"小游戏。

- 🏠 大厅：登录 / 创建房间 / 按 ID 加入 / 搜索 / 查看在线房间
- 🎨 游戏：房主在画板上作画，其他玩家在输入框中猜测答案
- 💬 实时聊天弹幕 + 🔴 实时同步画板
- 🏆 积分排行榜（房主不参与积分，只出题）
- ⚙️ 状态机：`lobby → drawing → roundOver`，每轮首个猜对答案的玩家 +1 分
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

- <http://localhost:8000/> — 大厅
- <http://localhost:8000/room/1234> — 游戏页（进入后会自动加入房间）

## 快速试玩

1. 浏览器 A：打开 `http://localhost:8000`，输入昵称"小明"，点击创建房间 → 自动跳转到游戏页，将看到房间 ID
2. 浏览器 B：在大厅输入该房间 ID 加入（或直接访问 `/room/{id}`）
3. 房主（浏览器 A）在答案输入框输入一个词，点击「确认并开启画板」，然后在画板上作画
4. 玩家（浏览器 B）在答案输入框输入猜测的词回车；猜对则 +1 分，画板锁定，本轮结束
5. 房主可以再次输入答案、开启画板开启新一轮

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
