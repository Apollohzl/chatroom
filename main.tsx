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
    <body><h2>{title}</h2>{children}</body>
  </html>)
}

app.get('/', (c: Context) => {
  return c.html(<Layout title={'chat room'}>
    <div style="margin:8px 0;">
      <span id="status" style="display:inline-block;padding:2px 10px;border-radius:12px;background:#eee;color:#fff;"><span id="seconds">0</span>s</span>
    </div>
    <div>
      <span id="login-area">
        用户名：<input id="username" autocomplete="off" />
        <button id="login-btn">登录</button>
      </span>
      <span id="logout-area" style="display:none;">
        <span id="current-user"></span>
        <button id="logout-btn">退出登录</button>
      </span>
    </div>
    <div>在线用户：<span id="users"></span></div>
    <div id='chat' style="margin:10px 0;padding:10px;border:1px solid #ccc;height:200px;overflow:auto"></div>
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
          $logoutArea.style.display = ''
          $currentUser.textContent = '当前用户：' + username
          $msg.disabled = false
          $msg.focus()
        }
      }
      function renderMsg(data) {
        const div = document.createElement('div')
        div.textContent = \`[\${data.time || ''}] \${data.user ? data.user + ': ' : ''}\${data.text}\`
        if (data.type === 'system') div.style.color = '#888'
        $chat.appendChild(div)
        $chat.scrollTop = $chat.scrollHeight
      }

      function updateStatus(online) {
        if (online) {
          $status.style.background = '#4caf50'
          $status.style.color = '#fff'
          seconds = 0
          $seconds.textContent = seconds
          if (timer) clearInterval(timer)
          timer = setInterval(() => {
            seconds++
            $seconds.textContent = seconds
          }, 1000)
        } else {
          $status.style.background = '#f44336'
          $status.style.color = '#fff'
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
          $loginArea.style.display = ''
          $logoutArea.style.display = 'none'
          $users.textContent = ''
          $chat.innerHTML = ''
          updateStatus(false)
        }
      }

      $loginBtn.onclick = () => {
        username = $username.value.trim()
        if (!username) return alert('请输入用户名')
        localStorage.setItem('chat-username', username) // 保存
        connect()
        $loginArea.style.display = 'none'
        $logoutArea.style.display = ''
        $currentUser.textContent = '当前用户：' + username
        $msg.disabled = false
        $msg.focus()
      }

      $logoutBtn.onclick = () => {
        if (ws) {
          ws.send(JSON.stringify({type: 'logout'}))
          ws.close()
        }
        localStorage.removeItem('chat-username') // 清除
        $loginArea.style.display = ''
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


Deno.serve(app.fetch)
