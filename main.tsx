import { Hono } from 'hono'
import type { Context } from 'hono'
import { upgradeWebSocket } from 'hono/deno'
import { html } from 'hono/html'
import type { FC, PropsWithChildren } from 'hono/jsx'
import { serveStatic } from 'hono/deno'
import { WSContext } from "hono/ws";

const app = new Hono()
app.use('/static/*', serveStatic({ root: './' }))
const Layout = ({ title, children }: PropsWithChildren<{ title: string }>) => {
  return (<html>
    <meta charset='UTF-8' />
    <title>{title}</title>
    <link rel="stylesheet" href="/static/css/home.css"></link>
    <body>
      <h2>
        <div onclick="openn('h')">apollo小黄</div> and <div onclick="openn('n')">Nahida</div> chat room
      </h2>
      {children}
      
      <script src="/static/js/home.js"></script>
    </body>
    <footer class="copyright-footer">
        <p>© 2025 Apollo and Nahida. All rights reserved.</p>
    </footer>
  </html>)
}

app.get('/', (c: Context) => {
  return c.html(<Layout title={`小黄 and Nahida 's chat room`}>
    <div class="control-panel">
      <span id="status" data-connected="false">
        <span id="seconds">0</span>s
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
    
    <div id="users-panel">
      在线用户：<span id="users"></span>
    </div>
    
    <div id="chat"></div>
    
    <input id="msg" placeholder="输入消息并回车发送" autocomplete="off" disabled />
    
  </Layout>)
})

// 存储所有已连接的 WebSocket 客户端及用户名
const clients = new Map<WSContext<WebSocket>, string>()

app.get(
  '/ws',
  upgradeWebSocket((c) => {
    let user = ''
    return {
      onOpen: (event) => {
        // 等待客户端发送登录信息
      },
      onMessage(event, ws) {
        try {
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
        } catch {
          console.log('Invalid message:', event.data.toString())
         }
      },
      onClose: (event, ws) => {
        if (clients.has(ws)) {
          broadcastSystemMsg(`${clients.get(ws)} 离开了聊天室`)
        }
        clients.delete(ws)
        broadcastUsers()
      },
      onError: (event, ws) => {
        clients.delete(ws)
        console.log('WebSocket error:', event)
        broadcastUsers()
      }
    }
  })
)

// 广播聊天消息
function broadcastMsg(user: string, text: string) {
  const msg = JSON.stringify({ type: 'msg', user, text, time: new Date().toLocaleTimeString() })
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      console.log(msg)
      ws.send(msg)
    }
  }
}

// 广播系统消息
function broadcastSystemMsg(text: string) {
  const msg = JSON.stringify({ type: 'system', text, time: new Date().toLocaleTimeString() })
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg)
      console.log(msg)
    }
  }
}

// 广播在线用户列表
function broadcastUsers() {
  const users = Array.from(clients.values())
  const msg = JSON.stringify({ type: 'users', users })
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg)
      console.log(msg)
    }
  }
}


// 获取本机局域网IP并打印 deno run -A main.tsx
const nets = Deno.networkInterfaces?.() ?? [];
let lanIps: string[] = [];
for (const net of nets) {
  if (net.family === "IPv4") {
    lanIps.push(net.address);
  }
}
console.log("本机局域网IP地址：");
lanIps.forEach(ip => {
  console.log(`  http://${ip}:8000`);
});
// Deno.serve({ hostname: "0.0.0.0", port: 8000 }, app.fetch)

Deno.serve(app.fetch)
