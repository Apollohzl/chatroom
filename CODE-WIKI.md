# Deno-Demo 项目 Code Wiki

> 基于 Deno + Hono 框架构建的实时聊天室 Web 应用，支持 WebSocket 实时消息推送、在线用户管理和响应式 UI。

---

## 1. 项目总览

### 1.1 项目简介

**deno-demo** 是一个轻量级的实时聊天 Web 应用，以 **Deno** 作为 JavaScript/TypeScript 运行时，配合 **Hono** 作为 Web 框架，实现了：

- 基于 HTTP 的静态资源服务（HTML/CSS/JS/图片）
- 基于 WebSocket 的实时双向消息推送
- 在线用户列表维护
- 用户名登录 / 登出
- 响应式的现代化 UI（支持浅色/深色模式）
- Deno Deploy 部署支持

### 1.2 技术栈

| 层级 | 技术 / 组件 | 版本 / 说明 |
| --- | --- | --- |
| 运行时 | Deno | 现代 TS/JS 运行时，自带 TypeScript、包管理、格式化、Lint 等工具 |
| Web 框架 | Hono | `jsr:@hono/hono@^4.8.3` — 轻量、高性能、跨平台 Web 框架 |
| 视图层 | Hono JSX | 服务端 JSX 渲染（`hono/jsx`） |
| 协议 | HTTP + WebSocket | `/` 提供页面，`/ws` 提供实时通信 |
| 前端 | 原生 JavaScript + CSS | 无构建步骤 |
| 部署 | Deno Deploy | 已在 `deno.json` 中配置项目 ID |
| IDE | Visual Studio Code | `.vscode/settings.json` 已配置 MicroPython 扩展按钮（仓库共用配置） |

### 1.3 运行环境要求

- **Deno** ≥ 1.40（推荐最新稳定版）
- 网络访问权限（`--allow-net`）
- 支持 WebSocket 的现代浏览器（Chrome/Edge/Firefox/Safari 最新版）

---

## 2. 目录结构

```
deno-demo/
├── main.tsx                  # 应用入口：路由、WebSocket、JSX 模板
├── deno.json                 # Deno 项目配置（依赖、任务、编译器选项、Deploy）
├── start.bat                 # Windows 一键启动脚本（备选）
├── README.md                 # 项目简介（仅一行 `deno task start`）
├── .gitignore                # Git 忽略规则
├── static/                   # 前端静态资源（由 serveStatic 托管）
│   ├── index.html            # 备用静态页面（主页面已由 main.tsx 动态渲染）
│   ├── index.txt             # 编码/密码学 CTF 风格趣味文本
│   ├── css/
│   │   └── home.css          # 聊天页面样式（响应式 + 深色模式）
│   ├── js/
│   │   └── home.js           # 前端逻辑：WebSocket 连接、消息渲染、登录状态
│   └── img/
│       └── head_img.jpg      # 站点 favicon / 头图
├── api/                      # 预留 API 目录（PHP 文件，当前为空）
│   ├── bodian/index.php
│   └── wangyi/index.php
└── docs/                     # 文档骨架（尚未填充）
    ├── architecture.md
    ├── design.md
    ├── changelog.md
    └── dev-notes.md
```

---

## 3. 整体架构

### 3.1 架构图（分层视图）

```
┌──────────────────────────────────────────────────────────────┐
│                       Browser (Client)                         │
│  ┌──────────────┐   ┌──────────────────────┐   ┌──────────┐  │
│  │  home.html   │◀──┤    home.js (WS API)  │◀──┤ home.css │  │
│  │  (动态渲染)   │   │  - 连接 / 登录 / 消息   │   │  (样式)    │  │
│  └──────▲───────┘   └───────────▲──────────┘   └──────────┘  │
│         │                       │                              │
│         │ HTTP / WebSocket      │                              │
└─────────┼───────────────────────┼──────────────────────────────┘
          │                       │
┌─────────▼───────────────────────▼──────────────────────────────┐
│                        Deno Runtime                              │
│  ┌────────────────────────────────────────────────────────┐    │
│  │                    Hono App (main.tsx)                   │    │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐  │    │
│  │  │  GET /       │   │  GET /ws     │   │ serveStatic  │  │    │
│  │  │  Layout()    │   │  upgradeWS   │   │  /static/*   │  │    │
│  │  │  JSX Render  │   │  WS Lifecycle│   │              │  │    │
│  │  └──────────────┘   └──────┬───────┘   └──────────────┘  │    │
│  │                            │                              │    │
│  │                  ┌─────────▼──────────┐                   │    │
│  │                  │ clients (Map)      │                   │    │
│  │                  │ WSContext → user   │                   │    │
│  │                  └─────────┬──────────┘                   │    │
│  │                            │                              │    │
│  │              ┌─────────────┼──────────────┐               │    │
│  │              ▼             ▼              ▼               │    │
│  │      broadcastMsg   broadcastSystem   broadcastUsers       │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                │
│  Deno.serve({...})  ← 监听 0.0.0.0:8000                         │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 架构模式

- **Serverless 风格**：Hono 应用通过 `Deno.serve(app.fetch)` 暴露一个标准的 fetch 处理函数，天然适配 Deno Deploy 边缘平台。
- **状态机式的 WS 生命周期**：每个 WebSocket 连接都经过 `onOpen → onMessage → onClose/onError`，其中 `user` 状态是一个闭包变量，在收到 `type: 'login'` 消息后才被"激活"。
- **广播模式（Fan-out）**：没有使用消息队列 / 数据库，所有连接保存在一个内存 `Map` 中，发送消息时遍历所有连接进行广播。此设计适合单实例演示场景。

### 3.3 数据流（一次完整消息）

```
浏览器用户输入
    │
    ▼
home.js → $msg keydown → ws.send({type:'msg', text})
    │
    ▼
main.tsx onMessage → data.type==='msg'
    │
    ▼
broadcastMsg(user, text)
    │
    ▼
对所有 clients.keys() 发送 JSON.stringify({type:'msg', user, text, time})
    │
    ▼
每个浏览器的 ws.onmessage → renderMsg(data) → 插入 DOM
```

---

## 4. 模块与文件职责

### 4.1 后端模块

| 文件 | 职责 | 关键依赖 |
| --- | --- | --- |
| [main.tsx](file:///f:/py/dev/deno-demo/main.tsx) | 应用入口；Hono 实例、路由定义、WebSocket 升级与生命周期、JSX 页面、广播函数、服务器启动与局域网 IP 打印 | `hono`、`hono/deno`、`hono/ws`、`hono/html`、`hono/jsx` |
| [deno.json](file:///f:/py/dev/deno-demo/deno.json) | Deno 项目配置：`imports` 映射、`tasks` 脚本、JSX 编译器选项、Deno Deploy 项目 ID | — |
| [start.bat](file:///f:/py/dev/deno-demo/start.bat) | Windows 一键启动脚本（`deno run -A main.tsx`），保留作为备选启动方式 | — |

### 4.2 前端模块

| 文件 | 职责 | 关键依赖 |
| --- | --- | --- |
| [static/index.html](file:///f:/py/dev/deno-demo/static/index.html) | 备用静态页面；实际主页面由 `main.tsx` 的 JSX `Layout` 动态渲染 | — |
| [static/js/home.js](file:///f:/py/dev/deno-demo/static/js/home.js) | 客户端核心逻辑：WebSocket 连接、登录/登出、消息渲染、在线用户展示、连接状态计时器、localStorage 用户名记忆 | 浏览器原生 `WebSocket` API |
| [static/css/home.css](file:///f:/py/dev/deno-demo/static/css/home.css) | UI 样式：CSS 变量主题、响应式布局、消息气泡、深色模式 (`prefers-color-scheme`)、页脚版权条 | — |
| [static/img/head_img.jpg](file:///f:/py/dev/deno-demo/static/img/head_img.jpg) | 网站 favicon 和头图 | — |

### 4.3 其他目录

| 目录 / 文件 | 状态 | 说明 |
| --- | --- | --- |
| `api/bodian/index.php` | 空文件 | 预留位置（可能用于 Bilibili 博电相关接口，由 PHP 环境托管） |
| `api/wangyi/index.php` | 空文件 | 预留位置（可能用于网易相关接口） |
| `docs/*.md` | 骨架文件 | [architecture.md](file:///f:/py/dev/deno-demo/docs/architecture.md)、[design.md](file:///f:/py/dev/deno-demo/docs/design.md)、[changelog.md](file:///f:/py/dev/deno-demo/docs/changelog.md)、[dev-notes.md](file:///f:/py/dev/deno-demo/docs/dev-notes.md) 均仅有标题，尚未填充 |

---

## 5. 关键类 / 函数详解

### 5.1 `Hono` 应用实例

[main.tsx#L9](file:///f:/py/dev/deno-demo/main.tsx#L9-L9)

```tsx
const app = new Hono()
```

- **作用**：创建 Hono 应用，作为所有路由与中间件的容器。
- **相关路由**：
  - `app.use('/static/*', serveStatic({ root: './' }))` — 托管静态资源
  - `app.get('/', ...)` — 主聊天页面
  - `app.get('/ws', upgradeWebSocket(...))` — WebSocket 升级端点

### 5.2 `Layout` JSX 组件

[main.tsx#L11-L28](file:///f:/py/dev/deno-demo/main.tsx#L11-L28)

```tsx
const Layout = ({ title, children }: PropsWithChildren<{ title: string }>) => {
  return (<html>
    <meta charset='UTF-8' />
    <title>{title}</title>
    <link rel="stylesheet" href="/static/css/home.css"></link>
    <link rel="icon" href="/static/img/head_img.jpg"></link>
    <body>
      <h2>
        <div onclick="openn('h')">apollo小黄</div> and <div onclick="openn('n')">Nahida</div> chat room
      </h2>
      {children}
      <script src="/static/js/home.js"></script>
    </body>
    <footer class="copyright-footer">...</footer>
  </html>)
}
```

- **职责**：页面模板组件，负责将标题、样式、脚本、页脚统一装配。
- **类型**：`FC`（Functional Component，来自 `hono/jsx`），接受 `PropsWithChildren<{ title: string }>`。
- **注意**：`onclick="openn(...)"` 直接写字符串，调用 `home.js` 中定义的 `openn()` 函数；这不是 React 事件绑定，而是 Hono JSX 渲染后的原生 HTML 属性。

### 5.3 主页面路由 `GET /`

[main.tsx#L30-L57](file:///f:/py/dev/deno-demo/main.tsx#L30-L57)

```tsx
app.get('/', (c: Context) => {
  return c.html(<Layout title={`小黄 and Nahida 's chat room`}>
    <div class="control-panel">
      <span id="status" data-connected="false">
        <span id="seconds" onClick="run()">0</span>s
      </span>
      <span id="login-area">
        <input id="username" autocomplete="off" placeholder="输入用户名" />
        <button id="login-btn">登录</button>
      </span>
      <span id="logout-area" style="display:none;">
        <span id="current-user"></span>
        <button id="logout-btn">退出登录</button>
      </span>
    </div>
    <div id="users-panel">在线用户：<span id="users"></span></div>
    <div id="chat"></div>
    <input id="msg" placeholder="输入消息并回车发送" autocomplete="off" disabled />
  </Layout>)
})
```

- **职责**：渲染聊天页面骨架，供 `home.js` 通过 `getElementById` 绑定事件。
- **关键 DOM id**（与前端一一对应）：
  - `status` / `seconds` — 连接状态与在线计时器
  - `login-area` / `logout-area` — 两套互斥面板
  - `username` / `login-btn` / `logout-btn` / `current-user`
  - `users` — 在线用户列表
  - `chat` — 消息容器
  - `msg` — 消息输入框

### 5.4 `clients` — 连接注册表

[main.tsx#L60](file:///f:/py/dev/deno-demo/main.tsx#L60-L60)

```tsx
const clients = new Map<WSContext<WebSocket>, string>()
```

- **类型**：`Map<WSContext<WebSocket>, string>` — 键为 Hono 封装的 WebSocket 上下文，值为该连接的登录用户名。
- **生命周期**：
  - 收到 `type: 'login'` 时 `clients.set(ws, user)`
  - 收到 `type: 'logout'` / `onClose` / `onError` 时 `clients.delete(ws)`
- **注意**：这是**进程内内存存储**。多实例（Deno Deploy 的多边缘节点）场景下，用户列表不会跨节点同步；需要引入 Redis/消息队列时应替换此结构。

### 5.5 WebSocket 端点 `GET /ws`

[main.tsx#L62-L101](file:///f:/py/dev/deno-demo/main.tsx#L62-L101)

```tsx
app.get('/ws', upgradeWebSocket((c) => {
  let user = ''
  return {
    onOpen(event) { /* 等待客户端 login */ },
    onMessage(event, ws) {
      const data = JSON.parse(event.data.toString())
      if (data.type === 'login') {
        user = data.user
        clients.set(ws, user)
        broadcastUsers()
        broadcastSystemMsg(`${user} 加入了聊天室`)
      } else if (data.type === 'msg') {
        if (user) broadcastMsg(user, data.text)
      } else if (data.type === 'logout') {
        ws.close()
      }
    },
    onClose(event, ws) {
      if (clients.has(ws)) broadcastSystemMsg(`${clients.get(ws)} 离开了聊天室`)
      clients.delete(ws)
      broadcastUsers()
    },
    onError(event, ws) {
      clients.delete(ws)
      broadcastUsers()
    }
  }
}))
```

- **事件模型**：标准 4 阶段（open/message/close/error）。
- **消息类型**（客户端 → 服务端）：
  - `{ type: 'login', user: string }`
  - `{ type: 'msg', text: string }`
  - `{ type: 'logout' }`
- **安全点**：
  - `if (user) broadcastMsg(...)` — 未登录用户的消息会被忽略。
  - JSON 解析失败时仅打印日志，不抛异常中断连接。

### 5.6 广播函数

#### `broadcastMsg(user, text)` — 用户消息广播

[main.tsx#L104-L112](file:///f:/py/dev/deno-demo/main.tsx#L104-L112)

```tsx
function broadcastMsg(user: string, text: string) {
  const msg = JSON.stringify({ type: 'msg', user, text, time: new Date().toLocaleTimeString() })
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      console.log(msg)
      ws.send(msg)
    }
  }
}
```

- **格式**：`{ type: 'msg', user, text, time }`
- **健壮性**：发送前检查 `readyState === OPEN`，避免向已关闭连接写入。

#### `broadcastSystemMsg(text)` — 系统消息广播

[main.tsx#L115-L123](file:///f:/py/dev/deno-demo/main.tsx#L115-L123)

```tsx
function broadcastSystemMsg(text: string) {
  const msg = JSON.stringify({ type: 'system', text, time: ... })
  for (const ws of clients.keys()) { ... }
}
```

- **用途**：用户加入/离开公告。

#### `broadcastUsers()` — 在线用户列表广播

[main.tsx#L126-L135](file:///f:/py/dev/deno-demo/main.tsx#L126-L135)

```tsx
function broadcastUsers() {
  const users = Array.from(clients.values())
  const msg = JSON.stringify({ type: 'users', users })
  for (const ws of clients.keys()) { ... }
}
```

- **触发时机**：每次 `login` / `close` / `error` 后调用。
- **格式**：`{ type: 'users', users: string[] }`

### 5.7 服务器启动 & 局域网 IP 检测

[main.tsx#L138-L152](file:///f:/py/dev/deno-demo/main.tsx#L138-L152)

```tsx
const nets = Deno.networkInterfaces?.() ?? [];
let lanIps: string[] = [];
for (const net of nets) {
  if (net.family === "IPv4") lanIps.push(net.address);
}
console.log("本机局域网IP地址：");
lanIps.forEach(ip => console.log(`  http://${ip}:8000`));

Deno.serve(app.fetch)
```

- **作用**：启动前自动扫描本机所有 IPv4 网卡并打印访问地址，方便在局域网内其他设备测试。
- **端口**：`Deno.serve` 默认端口为 `8000`，hostname 默认 `0.0.0.0`（在 Deno 新版中）。

### 5.8 前端核心：`home.js`

[static/js/home.js](file:///f:/py/dev/deno-demo/static/js/home.js) 中定义的关键函数：

| 函数 / 变量 | 签名 | 作用 |
| --- | --- | --- |
| `ws` | `WebSocket \| null` | 当前 WebSocket 连接 |
| `username` | `string` | 已登录用户名，保存在 `localStorage['chat-username']` |
| `connect()` | `() => void` | 创建 WS 连接，绑定 `onopen / onmessage / onclose`；`onopen` 自动发送 `login` |
| `renderMsg(data)` | `(data) => void` | 根据 `data.type` 渲染系统 / 用户消息气泡，区分"自己/他人" |
| `updateStatus(online)` | `(boolean) => void` | 更新连接状态徽标颜色，并启动在线秒数计时器 |
| `$loginBtn.onclick` | — | 校验用户名 → 写入 localStorage → 调用 `connect()` 并切换面板 |
| `$logoutBtn.onclick` | — | 发送 `logout` 消息、关闭连接、清空 UI |
| `$msg.onkeydown` | — | 回车触发发送 `{ type: 'msg', text }` |
| `openn(msg)` | `(string) => void` | 点击标题中"apollo小黄"/"Nahida"时跳转对应 Bilibili 空间 |
| `run()` | `() => void` | 点击秒数跳转到部署站点 `hzl-chatroom.deno.dev/static/` |
| `window.onload` | — | 若 `localStorage` 已有用户名，自动恢复登录并连接 |

---

## 6. WebSocket 消息协议

本项目采用**自定义的 JSON-over-WebSocket**协议。

### 6.1 客户端 → 服务端

| `type` | 字段 | 说明 |
| --- | --- | --- |
| `login` | `{ type: 'login', user: string }` | 登录；`user` 不能为空字符串 |
| `msg` | `{ type: 'msg', text: string }` | 发送聊天消息；未登录则忽略 |
| `logout` | `{ type: 'logout' }` | 请求服务端关闭连接 |

### 6.2 服务端 → 客户端

| `type` | 字段 | 说明 |
| --- | --- | --- |
| `msg` | `{ type: 'msg', user, text, time }` | 普通聊天消息 |
| `system` | `{ type: 'system', text, time }` | 系统公告（加入/离开） |
| `users` | `{ type: 'users', users: string[] }` | 在线用户列表 |

其中 `time` 由服务端使用 `new Date().toLocaleTimeString()` 生成（本地时区）。

### 6.3 时序图

```
Client A                Server                Client B
   │                      │                      │
   │ 1. GET /             │                      │
   │◀─────────────────────│                      │
   │    (HTML + JS/CSS)   │                      │
   │                      │                      │
   │ 2. GET /ws           │                      │
   │─────────────────────▶│                      │
   │    Upgrade WS        │                      │
   │◀─────────────────────│                      │
   │                      │                      │
   │ 3. {type:'login',user:'A'}                  │
   │─────────────────────▶│                      │
   │                      │ 4. broadcastUsers()  │
   │                      │─────────────────────▶│
   │                      │ 5. broadcastSystem() │
   │                      │─────────────────────▶│
   │                      │                      │
   │ 6. {type:'msg',text}│                      │
   │─────────────────────▶│                      │
   │                      │ 7. broadcastMsg()    │
   │◀─────────────────────│─────────────────────▶│
   │    (自己也会收到)    │                      │
   │                      │                      │
   │ 8. close             │                      │
   │─────────────────────▶│                      │
   │                      │ broadcastSystem()    │
   │                      │ broadcastUsers()     │
```

---

## 7. 依赖关系

### 7.1 外部依赖

[deno.json#L2-L4](file:///f:/py/dev/deno-demo/deno.json#L2-L4)

```jsonc
"imports": {
  "hono": "jsr:@hono/hono@^4.8.3"
}
```

- **唯一直接依赖**：`jsr:@hono/hono@^4.8.3`（通过 JSR 包仓库获取）。
- **Hono 子模块**（在 `main.tsx` 中用到）：
  - `hono` — 核心 `Hono` 类、`Context` 类型
  - `hono/deno` — `upgradeWebSocket`、`serveStatic`（Deno 运行时适配）
  - `hono/ws` — `WSContext` 类型
  - `hono/html` — `html` 辅助函数
  - `hono/jsx` — JSX 运行时（`FC`、`PropsWithChildren`）

### 7.2 Deno 内置 API

- `Deno.serve()` — HTTP 服务器
- `Deno.networkInterfaces()` — 读取本机网卡信息
- `WebSocket` — 标准 WebSocket API（Deno 全局提供）

### 7.3 内部模块依赖图

```
main.tsx (入口)
   ├── hono (app = new Hono())
   │     ├── GET /          → Layout(JSX)
   │     ├── GET /ws        → upgradeWebSocket
   │     │     ├── clients (Map)
   │     │     ├── broadcastMsg
   │     │     ├── broadcastSystemMsg
   │     │     └── broadcastUsers
   │     └── /static/*      → serveStatic
   └── Deno.serve
            └── 打印局域网 IP

home.js (浏览器端)
   ├── WebSocket API (浏览器内置)
   ├── localStorage
   └── DOM API (getElementById / createElement 等)

home.css (样式)
   └── CSS 变量 / @media prefers-color-scheme
```

---

## 8. 项目运行方式

### 8.1 安装 Deno

**Windows（PowerShell）**：

```powershell
irm https://deno.land/install.ps1 | iex
```

**macOS / Linux**：

```bash
curl -fsSL https://deno.land/install.sh | sh
```

安装后执行 `deno --version` 确认。

### 8.2 启动开发服务器

推荐方式（使用 `deno.json` 中定义的 task）：

```bash
cd deno-demo
deno task start     # 等价于 deno run --allow-net main.tsx
```

开发模式（文件变化自动重启）：

```bash
deno task dev       # 等价于 deno run --allow-net --watch main.tsx
```

**Windows 备选**：双击 [start.bat](file:///f:/py/dev/deno-demo/start.bat)（等同于 `deno run -A main.tsx`，授予全部权限）。

### 8.3 访问

启动后终端会打印：

```
本机局域网IP地址：
  http://192.168.x.x:8000
  http://127.0.0.1:8000
```

- 本地访问：<http://localhost:8000>
- 局域网内其他设备访问：使用打印出的 `192.168.x.x:8000`
- 已部署地址（`home.js` `run()` 函数跳转目标）：<https://hzl-chatroom.deno.dev/static/>

### 8.4 权限说明

| 权限 | 用途 |
| --- | --- |
| `--allow-net` | 监听 8000 端口、建立 WebSocket 连接 |
| `--allow-read` | `serveStatic` 需要读取 `./static/`（Hono 的 `serveStatic` 会自动申请） |

`deno task start` 显式声明了 `--allow-net`；`start.bat` 使用 `-A`（全部权限），适合本地快速测试。

### 8.5 部署到 Deno Deploy

通过 Deno Deploy 的 Git 集成部署，配置项目名 `nhwc`，入口 `main.tsx`。部署后访问：<https://nhwc.nhwc.deno.dev>

- 所需权限：`--allow-net`（WebSocket 与 HTTP）、`--allow-sys`（读取局域网 IP）、`--allow-read`（读取静态文件）
- 已在 `deno.json` 中声明 `deploy.project = "nhwc"`

---

## 9. 配置文件详解

### 9.1 `deno.json`

[deno.json](file:///f:/py/dev/deno-demo/deno.json)

```jsonc
{
  "imports": { "hono": "jsr:@hono/hono@^4.8.3" },
  "tasks": {
    "start": "deno run --allow-net main.tsx",
    "dev":   "deno run --allow-net --watch main.tsx"
  },
  "compilerOptions": {
    "jsx": "precompile",
    "jsxImportSource": "hono/jsx"
  },
  "deploy": { ... }
}
```

- `"jsx": "precompile"`：Hono 4.x 推荐模式，JSX 被编译为 `hono/jsx` 风格的 `jsx()` 调用。
- `"jsxImportSource": "hono/jsx"`：指定 JSX 工厂模块来源。

### 9.2 `.gitignore`

[.gitignore](file:///f:/py/dev/deno-demo/.gitignore)

忽略 `deno.lock`、`deno_dir/`、`.vscode/`、`*.log`、`.env*`、`coverage/`、临时文件等。

---

## 10. 前端样式与交互

### 10.1 主题与配色（CSS 变量）

[static/css/home.css#L1-L13](file:///f:/py/dev/deno-demo/static/css/home.css#L1-L13)

| 变量 | 默认值（浅色） | 说明 |
| --- | --- | --- |
| `--primary-color` | `#4361ee` | 主色（按钮、"自己"消息气泡） |
| `--secondary-color` | `#3a0ca3` | 次色（hover） |
| `--success-color` | `#4cc9f0` | 连接成功（绿色徽标） |
| `--danger-color` | `#f72585` | 未连接 / 登出按钮（品红色） |
| `--card-bg` | `#ffffff` | 面板背景 |
| `--light-text` | `#49fff6` | 浅色文字（青绿色） |

### 10.2 深色模式

[static/css/home.css#L16-L24](file:///f:/py/dev/deno-demo/static/css/home.css#L16-L24)

```css
@media (prefers-color-scheme: dark) {
  :root {
    --light-bg: #212529;
    --card-bg:  #2b2d42;
    --dark-text:#00fbff;
    ...
  }
}
```

根据系统设置自动切换；无需手动切换按钮。

### 10.3 消息气泡规则

- `.user-message`（`data.user === username`）：右侧、主色背景、白色文字
- `.other-message`：左侧、灰色背景
- `.system-message`：居中、小号灰色文字，用于"xx 加入了聊天室"

### 10.4 响应式

- 宽度 ≤ 768px：body 内边距缩小，消息最大宽度提升到 90%
- `.control-panel` 使用 `flex-wrap: wrap`，在窄屏上自动换行

---

## 11. 设计权衡与局限

| 问题 | 当前做法 | 改进方向 |
| --- | --- | --- |
| **用户身份** | 客户端自报用户名，无验证 | 引入 token / OAuth / 昵称去重与黑名单 |
| **消息持久化** | 纯内存广播；刷新页面即丢失历史 | 引入 SQLite（`deno` 内置）/ Redis / Postgres 持久化 |
| **多实例同步** | `clients` Map 仅在同一进程内可见；Deno Deploy 多边缘节点下无法跨节点广播 | 使用 BroadcastChannel（同区域）或 Redis Pub/Sub / Deno KV watch |
| **消息大小 / 速率** | 无限制，可能被恶意刷屏 | 添加速率限制、最大消息长度校验 |
| **XSS 风险** | `renderMsg` 使用 `innerHTML = content`，若 `data.user` / `data.text` 含 `<script>` 会造成注入 | 在服务端对消息做 HTML 转义，或在前端使用 `textContent` |
| **时区** | `toLocaleTimeString()` 使用服务端本地时区 | 统一使用 ISO 时间戳，前端做本地化渲染 |
| **心跳 / 超时** | 未发送 ping/pong | 定期 ping 检测僵死连接 |

---

## 12. 常见问题 FAQ

**Q1：启动报错 `error: Module not found "jsr:@hono/hono"`？**
A：确认 Deno 版本 ≥ 1.40（支持 JSR）。执行 `deno upgrade` 升级。

**Q2：局域网内手机无法访问？**
A：检查 Windows 防火墙是否放行 8000 端口；确保终端打印出的 `192.168.x.x` 属于同一子网。

**Q3：刷新后消息丢失？**
A：设计如此（见 §11）。若需历史消息，需要在服务端持久化并在客户端连接成功后拉取历史。

**Q4：`home.js` 中 `run()` 跳转到 `hzl-chatroom.deno.dev` 是什么？**
A：作者部署的在线 Demo 站点（可在 [main.tsx#L19](file:///f:/py/dev/deno-demo/main.tsx#L19-L19)、[home.js#L137-L139](file:///f:/py/dev/deno-demo/static/js/home.js#L137-L139) 中修改为自己的域名）。

**Q5：`api/bodian/` 与 `api/wangyi/` 的 PHP 文件是空的？**
A：这是预留目录，当前并未被 Deno 服务路由。如果需要启用，需要单独配置 PHP 环境，并在前端通过 `fetch()` 访问。

---

## 13. 下一步扩展建议

1. **消息持久化**：使用 Deno 内置的 `Deno.openKv()` 或 SQLite 存储最近 N 条消息，新连接登录后拉取历史。
2. **用户身份强化**：引入昵称唯一校验、黑名单、简易 token。
3. **多节点消息同步**：引入 Redis Pub/Sub 或 Deno KV 的 list + watch 做跨节点广播。
4. **富文本 / 表情 / 图片**：扩展消息协议，支持 `emoji` / `image url` / `file`。
5. **心跳保活**：客户端定时 `ws.send({type:'ping'})`，服务端回复 `pong`；超时则判定掉线。
6. **TypeScript 化前端**：将 `home.js` 迁移为 `home.ts`，引入前端类型安全。
7. **单元测试**：使用 `deno test` 为 `broadcast*` 系列函数编写测试。
8. **填充 `docs/*.md`**：当前架构/设计/变更日志/开发笔记均为骨架，可按项目进展逐步完善。

---

> 本 Wiki 基于 `deno-demo/` 当前代码（2025-版本）自动生成，如后续代码有重大改动请同步维护此文档。
