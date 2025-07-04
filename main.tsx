import { Hono } from 'hono'
import type { Context } from 'hono'
import { upgradeWebSocket } from 'hono/deno'
import { html } from 'hono/html'
import type { FC, PropsWithChildren } from 'hono/jsx'
import { WSContext } from "hono/ws";

const app = new Hono()

const Layout = ({ title, children }: PropsWithChildren<{ title: string }>) => {
  return (<html>
    <meta charset='UTF-8' />
    <title>{title}</title>
    <style>{`
      :root {
        --primary-color: #4361ee;
        --secondary-color: #3a0ca3;
        --success-color: #4cc9f0;
        --danger-color: #f72585;
        --light-bg: #f8f9fa;
        --dark-bg: #212529;
        --light-text: #f8f9fa;
        --dark-text: #212529;
        --card-bg: #ffffff;
        --border-radius: 12px;
        --box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        --transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --light-bg: #212529;
          --dark-bg: #f8f9fa;
          --light-text: #212529;
          --dark-text: #f8f9fa;
          --card-bg: #2b2d42;
        }
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        background-color: var(--light-bg);
        color: var(--dark-text);
        min-height: 100vh;
        padding: 2rem;
        transition: var(--transition);
      }

      h2 {
        color: var(--primary-color);
        margin-bottom: 1.5rem;
        text-align: center;
        font-weight: 600;
      }

      #status {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border-radius: 50px;
        background-color: var(--danger-color);
        color: var(--light-text);
        font-size: 0.9rem;
        font-weight: 500;
        box-shadow: var(--box-shadow);
        transition: var(--transition);
      }

      #status[data-connected="true"] {
        background-color: var(--success-color);
      }

      #status::before {
        content: "";
        display: block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background-color: currentColor;
      }

      .control-panel {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        align-items: center;
        margin-bottom: 1.5rem;
        padding: 1rem;
        background-color: var(--card-bg);
        border-radius: var(--border-radius);
        box-shadow: var(--box-shadow);
      }

      input {
        padding: 0.75rem 1rem;
        border: 2px solid #e9ecef;
        border-radius: var(--border-radius);
        font-size: 1rem;
        transition: var(--transition);
        flex: 1;
        min-width: 200px;
      }

      input:focus {
        outline: none;
        border-color: var(--primary-color);
        box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.2);
      }

      button {
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: var(--border-radius);
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: var(--transition);
        box-shadow: var(--box-shadow);
      }

      #login-btn {
        background-color: var(--primary-color);
        color: white;
      }

      #login-btn:hover {
        background-color: var(--secondary-color);
        transform: translateY(-2px);
      }

      #logout-btn {
        background-color: var(--danger-color);
        color: white;
      }

      #logout-btn:hover {
        opacity: 0.9;
        transform: translateY(-2px);
      }

      #users-panel {
        margin-bottom: 1.5rem;
        padding: 1rem;
        background-color: var(--card-bg);
        border-radius: var(--border-radius);
        box-shadow: var(--box-shadow);
      }

      #users {
        font-weight: 600;
        color: var(--primary-color);
      }

      #chat {
        margin-bottom: 1.5rem;
        padding: 1.5rem;
        background-color: var(--card-bg);
        border-radius: var(--border-radius);
        box-shadow: var(--box-shadow);
        height: 400px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .message {
        max-width: 80%;
        padding: 0.75rem 1rem;
        border-radius: 1rem;
        animation: fadeIn 0.3s ease-out;
      }

      .user-message {
        align-self: flex-end;
        background-color: var(--primary-color);
        color: white;
        border-bottom-right-radius: 0.25rem;
      }

      .other-message {
        align-self: flex-start;
        background-color: #e9ecef;
        color: var(--dark-text);
        border-bottom-left-radius: 0.25rem;
      }

      .system-message {
        align-self: center;
        background-color: transparent;
        color: #6c757d;
        font-size: 0.9rem;
        text-align: center;
        padding: 0.5rem;
      }

      .message-time {
        font-size: 0.75rem;
        opacity: 0.7;
        margin-top: 0.25rem;
      }

      #msg {
        width: 100%;
        padding: 1rem;
        font-size: 1rem;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (max-width: 768px) {
        body {
          padding: 1rem;
        }
        
        .message {
          max-width: 90%;
        }
      }
    `}</style>
    <body>
      <h2>{title}</h2>
      {children}
    </body>
  </html>)
}

app.get('/', (c: Context) => {
  return c.html(<Layout title={`Apollo and Nahida 's HZL chat room`}>
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
    
    {html`<script>
      let ws = null
      let username = ''
      const $chat = document.getElementById('chat')
      const $msg = document.getElementById('msg')
      const $users = document.getElementById('users')
      const $loginArea = document.getElementById('login-area')
      const $logoutArea = document.getElementById('logout-area')
      const $username = document.getElementById('username')
      const $loginBtn = document.getElementById('login-btn')
      const $logoutBtn = document.getElementById('logout-btn')
      const $currentUser = document.getElementById('current-user')
      const $status = document.getElementById('status')
      const $seconds = document.getElementById('seconds')
      let timer = null
      let seconds = 0

      window.onload = () => {
        const saved = localStorage.getItem('chat-username')
        if (saved) {
          username = saved
          $username.value = saved
          connect()
          $loginArea.style.display = 'none'
          $logoutArea.style.display = 'flex'
          $currentUser.textContent = username
          $msg.disabled = false
          $msg.focus()
        }
      }

      function renderMsg(data) {
        const div = document.createElement('div')
        div.className = 'message ' + 
          (data.type === 'system' ? 'system-message' : 
           data.user === username ? 'user-message' : 'other-message')
        
        let content = ''
        if (data.type === 'system') {
          content = data.text
        } else {
          content = \`\${data.text}<div class="message-time">\${data.time || ''}\${
            data.user === username ? '' : ' · ' + data.user
          }</div>\`
        }
        
        div.innerHTML = content
        $chat.appendChild(div)
        $chat.scrollTop = $chat.scrollHeight
      }

      function updateStatus(online) {
        $status.setAttribute('data-connected', online.toString())
        if (online) {
          seconds = 0
          $seconds.textContent = seconds
          if (timer) clearInterval(timer)
          timer = setInterval(() => {
            seconds++
            $seconds.textContent = seconds
          }, 1000)
        } else {
          if (timer) clearInterval(timer)
          timer = null
          seconds = 0
          $seconds.textContent = seconds
        }
      }

      function connect() {
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
        ws = new WebSocket(protocol + '://' + location.host + '/ws')
        
        ws.onopen = () => {
          ws.send(JSON.stringify({type: 'login', user: username}))
          updateStatus(true)
        }
        
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data)
          if (data.type === 'msg' || data.type === 'system') {
            renderMsg(data)
          } else if (data.type === 'users') {
            $users.textContent = data.users.join(', ')
          }
        }
        
        ws.onclose = () => {
          $msg.disabled = true
          $loginArea.style.display = 'flex'
          $logoutArea.style.display = 'none'
          $users.textContent = ''
          $chat.innerHTML = ''
          updateStatus(false)
        }
      }

      $loginBtn.onclick = () => {
        username = $username.value.trim()
        if (!username) return alert('请输入用户名')
        localStorage.setItem('chat-username', username)
        connect()
        $loginArea.style.display = 'none'
        $logoutArea.style.display = 'flex'
        $currentUser.textContent = username
        $msg.disabled = false
        $msg.focus()
      }

      $logoutBtn.onclick = () => {
        if (ws) {
          ws.send(JSON.stringify({type: 'logout'}))
          ws.close()
        }
        localStorage.removeItem('chat-username')
        $loginArea.style.display = 'flex'
        $logoutArea.style.display = 'none'
        $msg.disabled = true
        $username.value = ''
        username = ''
        $users.textContent = ''
        $chat.innerHTML = ''
        updateStatus(false)
      }

      $msg.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && $msg.value.trim() && ws && ws.readyState === 1) {
          ws.send(JSON.stringify({type: 'msg', text: $msg.value}))
          $msg.value = ''
        }
      })
    </script>`}
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
        } catch { }
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
