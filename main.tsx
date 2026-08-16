import { Hono } from 'hono'
import type { Context } from 'hono'
import { upgradeWebSocket } from 'hono/deno'
import { html } from 'hono/html'
import type { FC, PropsWithChildren } from 'hono/jsx'
import { WSContext } from 'hono/ws'

// 解析项目根目录（与 main.tsx 同级）
const __filename = new URL('', import.meta.url).pathname.replace(/^\/([A-Z]):\//, '$1:/')
const PROJECT_ROOT = __filename.substring(0, __filename.lastIndexOf('/'))
const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}

async function serveStaticFile(c: Context): Promise<Response | null> {
  const urlPath = c.req.path
  if (!urlPath.startsWith('/static/')) return null
  const relative = decodeURIComponent(urlPath.substring(1)) // e.g. "static/css/home.css"
  // normalize: replace both '/' and '\'  with system separator
  const fullPath = PROJECT_ROOT + '/' + relative
  try {
    const stat = await Deno.stat(fullPath)
    if (!stat.isFile) return null
    const ext = fullPath.substring(fullPath.lastIndexOf('.')).toLowerCase()
    const data = await Deno.readFile(fullPath)
    return new Response(data, {
      status: 200,
      headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' },
    })
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null
    return new Response('500 Internal Server Error', { status: 500 })
  }
}

// ============================================================
// 类型定义
// ============================================================
type ClientInfo = {
  user: string
  roomId: string | null
  ws: WSContext<WebSocket>
  // 心跳时间戳：最后一次收到该连接任何消息的时间
  lastHeartbeat: number
}

type ScoreboardEntry = {
  user: string
  score: number
}

type ChatMessage = {
  user: string
  text: string
  time: string
  isSystem?: boolean
  isCorrect?: boolean
  inChat?: boolean // false：不显示在聊天区
}

type Room = {
  id: string
  // 当前画手（轮流担任，不再是固定房主）
  currentDrawer: string | null
  players: Set<string>
  // 进入房间的顺序，用于「轮换到下一位画手」
  turnOrder: string[]
  state: 'lobby' | 'drawing' | 'roundOver'
  answer: string | null
  canvasHistory: string
  // 每轮 winner，用于判定之后是否进入下一轮
  lastWinner: string | null
  scoreboard: ScoreboardEntry[]
  chat: ChatMessage[]
  createdAt: number
}

// ============================================================
// 全局状态
// ============================================================
const app = new Hono()
const clients = new Map<WSContext<WebSocket>, ClientInfo>()

// 全局唯一的房间：登录即自动进入，无需创建/加入
const DEFAULT_ROOM_ID = '1'
const rooms = new Map<string, Room>()

function createDefaultRoom(): Room {
  return {
    id: DEFAULT_ROOM_ID,
    currentDrawer: null,
    players: new Set<string>(),
    turnOrder: [],
    state: 'lobby',
    answer: null,
    canvasHistory: '',
    lastWinner: null,
    scoreboard: [],
    chat: [
      { user: 'system', text: '欢迎来到房间，大家轮流作画猜词吧！', time: nowStr(), isSystem: true },
    ],
    createdAt: Date.now(),
  }
}
rooms.set(DEFAULT_ROOM_ID, createDefaultRoom())

// 心跳：超过该时长没有任何消息（心跳）则判定为卡死，清除其个人信息
const HEARTBEAT_TIMEOUT = 10 * 60 * 1000 // 10 分钟
const HEARTBEAT_CHECK_INTERVAL = 30 * 1000 // 每 30 秒扫描一次

// ============================================================
// 后台入口：隐藏入口令牌 + 门禁
// 只有从首页（点击「猜词游戏」10 次）触发 /admin/grant 才能拿到令牌，
// 直接访问 /admin 会因缺少该 cookie 被拒绝。
// ============================================================
const adminGrants = new Map<string, number>() // token -> 过期时间戳(ms)
const ADMIN_GRANT_TTL = 10 * 60 * 1000 // 令牌有效期 10 分钟

function genAdminToken(): string {
  return crypto.randomUUID()
}

function parseCookies(c: Context): Record<string, string> {
  const raw = c.req.header('Cookie') || ''
  const out: Record<string, string> = {}
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

// 校验后台访问权限：必须携带有效的 admin_entry cookie
function requireAdmin(c: Context): boolean {
  const token = parseCookies(c)['admin_entry']
  if (!token) return false
  const exp = adminGrants.get(token)
  if (!exp) return false
  if (Date.now() > exp) {
    adminGrants.delete(token)
    return false
  }
  return true
}

// ============================================================
// 工具函数
// ============================================================
function nowStr(): string {
  return new Date().toLocaleTimeString()
}

function send(ws: WSContext<WebSocket>, obj: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj))
  }
}

function broadcastToRoom(roomId: string, obj: unknown, exceptWs?: WSContext<WebSocket>) {
  const payload = JSON.stringify(obj)
  for (const [ws, info] of clients) {
    if (info.roomId === roomId && ws !== exceptWs && ws.readyState === WebSocket.OPEN) {
      ws.send(payload)
    }
  }
}

function publicRoomState(room: Room) {
  return {
    id: room.id,
    host: room.currentDrawer, // 兼容前端字段：当前画手
    currentDrawer: room.currentDrawer,
    players: Array.from(room.players),
    turnOrder: room.turnOrder,
    state: room.state,
    canvasHistory: room.canvasHistory,
    scoreboard: room.scoreboard,
    chat: room.chat.slice(-200),
    hasAnswer: !!room.answer,
  }
}

function ensureScore(room: Room, user: string) {
  if (!room.scoreboard.find((s) => s.user === user)) {
    room.scoreboard.push({ user, score: 0 })
  }
}

// 计算「下一位画手」：按进入房间顺序，从 fromUser 的下一个开始
function nextDrawer(room: Room, fromUser: string | null): string | null {
  const order = room.turnOrder.filter((p) => room.players.has(p))
  if (order.length === 0) return null
  const idx = order.indexOf(fromUser ?? '')
  const nextIdx = idx < 0 ? 0 : (idx + 1) % order.length
  return order[nextIdx]
}

// ============================================================
// JSX 页面组件
// ============================================================
const Layout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title}</title>
    <link rel="stylesheet" href="/static/css/home.css" />
    <link rel="icon" href="/static/img/head_img.jpg" />
    <body>
      {children}
      <script src="/static/js/home.js" />
      <footer class="copyright-footer">
        <p>© 2025 你画我猜 · Apollo &amp; Nahida</p>
      </footer>
    </body>
  </html>
)

// 后台管理页布局（与游戏页隔离，独立加载 admin.js / admin.css）
const AdminLayout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title}</title>
    <link rel="stylesheet" href="/static/css/home.css" />
    <link rel="stylesheet" href="/static/css/admin.css" />
    <link rel="icon" href="/static/img/head_img.jpg" />
    <body>
      {children}
      <script src="/static/js/admin.js" />
    </body>
  </html>
)

// 单页：登录面板 + 游戏区（登录后显示）
app.get('/', (c: Context) => {
  return c.html(
    <Layout title="你画我猜 · 单房间版">
      <div id="app">
        {/* 登录面板 */}
        <section id="login-section" class="panel">
          <h1 class="brand">你画我猜</h1>
          <p class="subtitle">实时多人协作<span id="secret-entry" class="secret-entry" title="彩蛋入口">猜词游戏</span></p>
          <div class="input-row">
            <input id="username" autocomplete="off" placeholder="输入你的昵称" />
            <button id="login-btn" class="primary">进入游戏</button>
          </div>
          <p class="hint">登录后自动进入唯一房间，大家轮流作画，其他人猜词。</p>
        </section>

        {/* 游戏区（登录后由 JS 取消隐藏） */}
        <section id="game-section" class="hidden">
          <header class="game-header">
            <div class="left">
              <div class="room-info">
                房间 <b id="room-id">1</b>
                <small>
                  当前画手：<span id="room-host">—</span>
                </small>
              </div>
            </div>
            <div class="center">
              <span id="game-state" class="state-tag">等待中</span>
              <small>在线 <span id="player-count">0</span> 人</small>
            </div>
            <div class="right">
              <button class="ghost" id="logout-btn">退出登录</button>
            </div>
          </header>

          <main class="game-main">
            <section class="canvas-section">
              <div class="canvas-toolbar" id="canvas-toolbar" style={{ display: 'none' }}>
                <span>画笔：</span>
                <div class="color-palette" id="color-palette">
                  <button data-color="#1f2937" class="color-dot active" style={{ background: '#1f2937' }} />
                  <button data-color="#ef4444" class="color-dot" style={{ background: '#ef4444' }} />
                  <button data-color="#f59e0b" class="color-dot" style={{ background: '#f59e0b' }} />
                  <button data-color="#10b981" class="color-dot" style={{ background: '#10b981' }} />
                  <button data-color="#3b82f6" class="color-dot" style={{ background: '#3b82f6' }} />
                  <button data-color="#8b5cf6" class="color-dot" style={{ background: '#8b5cf6' }} />
                  <button data-color="#ec4899" class="color-dot" style={{ background: '#ec4899' }} />
                  <button data-color="eraser" class="color-dot eraser" title="橡皮擦">⌫</button>
                </div>
                <button id="clear-canvas-btn" class="ghost">清空画板</button>
              </div>
              <div class="canvas-wrapper">
                <canvas id="board" width="700" height="700" />
                <div id="canvas-overlay" class="canvas-overlay">等待画手开始本轮…</div>
              </div>

              {/* 答案输入区（当前画手） */}
              <div id="host-answer-bar" class="answer-bar" style={{ display: 'none' }}>
                <label>设置答案（本轮词汇）：</label>
                <input id="answer-input" placeholder="例如：苹果、闪电、皮卡丘" />
                <button id="start-drawing-btn" class="primary">确认并开启画板</button>
                <small class="hint">玩家会在输入正确答案后 +1 分，画板将在命中后锁定。</small>
              </div>
            </section>

            <aside class="side-section">
              <div class="panel leaderboard">
                <h3>积分排行榜</h3>
                <ol id="leaderboard">
                  <li class="empty">暂无数据</li>
                </ol>
              </div>

              <div class="panel chat-panel">
                <h3>弹幕聊天</h3>
                <div id="chat" class="chat-box">
                  <div class="message system-message">欢迎进入房间，聊天与答案都实时同步。</div>
                </div>
                <div class="chat-input">
                  <input id="chat-input" placeholder="输入消息 / 答案" maxlength={50} autocomplete="off" />
                  <button id="chat-send" class="primary">发送</button>
                </div>
              </div>
            </aside>
          </main>
        </section>
      </div>
    </Layout>
  )
})

// ============================================================
// 后台入口：签发令牌（只有首页隐藏入口会调用）
// ============================================================
app.post('/admin/grant', (c: Context) => {
  const token = genAdminToken()
  adminGrants.set(token, Date.now() + ADMIN_GRANT_TTL)
  c.header(
    'Set-Cookie',
    `admin_entry=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(ADMIN_GRANT_TTL / 1000)}; SameSite=Lax`
  )
  return c.json({ ok: true })
})

// ============================================================
// 后台管理页（受门禁保护）
// ============================================================
app.get('/admin', (c: Context) => {
  if (!requireAdmin(c)) {
    return c.html(
      '<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><title>禁止访问</title>' +
        '<style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
        'background:#0f172a;color:#e5e7eb;display:flex;align-items:center;justify-content:center;' +
        'height:100vh;margin:0}div{text-align:center}h1{font-size:32px}small{color:#94a3b8}' +
        'a{color:#5b5bd6}</style></head><body><div><h1>🚫 403 禁止直接访问</h1>' +
        '<p>后台管理页只能从首页点击隐藏入口进入。</p>' +
        '<p><small>请返回首页，连续点击「猜词游戏」10 次以解锁。</small></p>' +
        '<p><a href="/">← 返回首页</a></p></div></body></html>',
      403
    )
  }
  return c.html(
    <AdminLayout title="后台管理 · 你画我猜">
      <div id="admin-app" class="admin-wrap">
        <header class="admin-header">
          <h1>后台管理 · 你画我猜</h1>
          <button class="ghost" id="back-home" type="button">返回首页</button>
        </header>

        <section class="panel">
          <h3>房间状态</h3>
          <div id="room-status" class="room-status">加载中…</div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>
              在线用户 <span id="online-count" class="badge">0</span>
            </h3>
          </div>
          <ul id="user-list" class="user-list" />
        </section>

        <section class="panel">
          <h3>房间控制</h3>
          <p class="muted">
            强制重启将踢出所有用户、删除所有用户数据（昵称、积分、绘画顺序）以及房间全部状态，
            房间回到初始空状态。
          </p>
          <button class="danger" id="reset-room-btn" type="button">强制重启房间</button>
        </section>
      </div>
    </AdminLayout>
  )
})

// 在线用户 / 房间状态（受门禁保护）
app.get('/admin/api/state', (c: Context) => {
  if (!requireAdmin(c)) return c.json({ error: 'forbidden' }, 403)
  const room = rooms.get(DEFAULT_ROOM_ID)
  const players = room
    ? Array.from(room.players).map((u) => ({
        user: u,
        isDrawer: room.currentDrawer === u,
        score: (room.scoreboard.find((s) => s.user === u)?.score) ?? 0,
      }))
    : []
  return c.json({
    players,
    room: room
      ? {
          id: room.id,
          state: room.state,
          currentDrawer: room.currentDrawer,
          playerCount: room.players.size,
          scoreboard: room.scoreboard,
          answerSet: !!room.answer,
        }
      : null,
  })
})

// 删除指定用户（踢出其连接并清除其房间内个人数据）
app.post('/admin/api/users/:name/delete', (c: Context) => {
  if (!requireAdmin(c)) return c.json({ error: 'forbidden' }, 403)
  const name = decodeURIComponent(c.req.param('name'))
  const toRemove: WSContext<WebSocket>[] = []
  for (const [ws, info] of clients) {
    if (info.user === name && info.roomId === DEFAULT_ROOM_ID) toRemove.push(ws)
  }
  toRemove.forEach((ws) => removeClient(ws, '管理员删除'))
  return c.json({ ok: true, removed: toRemove.length })
})

// 强制重启房间：踢出所有人 + 清空所有用户数据与房间状态
app.post('/admin/api/room/reset', (c: Context) => {
  if (!requireAdmin(c)) return c.json({ error: 'forbidden' }, 403)
  forceRestartRoom()
  return c.json({ ok: true })
})

function forceRestartRoom() {
  const room = rooms.get(DEFAULT_ROOM_ID)
  if (room) {
    const toKick = Array.from(clients.entries())
      .filter(([, info]) => info.roomId === DEFAULT_ROOM_ID)
      .map(([ws]) => ws)
    for (const ws of toKick) removeClient(ws, '管理员强制重启房间')
  }
  // 用全新的空房间替换（所有玩家、积分、顺序、画板、答案、聊天均清空）
  rooms.set(DEFAULT_ROOM_ID, createDefaultRoom())
}

// 静态资源
app.use('/static/*', async (c, next) => {
  const res = await serveStaticFile(c)
  if (res) return res
  return next()
})

// ============================================================
// WebSocket 主入口
// ============================================================
app.get(
  '/ws',
  upgradeWebSocket(() => {
    return {
      onOpen: () => {
        // 连接建立后等待客户端 login
      },
      onMessage(event, ws) {
        try {
          const data = JSON.parse(event.data.toString())
          handleMessage(ws, data)
        } catch (e) {
          console.log('WS parse error:', e, event.data.toString())
          send(ws, { type: 'system', text: '无效的消息格式', time: nowStr() })
        }
      },
      onClose(_evt, ws) {
        removeClient(ws, '连接断开')
      },
      onError(_evt, ws) {
        removeClient(ws, '连接异常')
      },
    }
  })
)

// 移除一个连接并同步房间状态（用于断线 / 主动退出 / 心跳超时）
function removeClient(ws: WSContext<WebSocket>, reason: string) {
  const info = clients.get(ws)
  if (!info) return
  const user = info.user
  const roomId = info.roomId
  clients.delete(ws)

  if (roomId) {
    const room = rooms.get(roomId)
    if (room) {
      const wasDrawer = room.currentDrawer === user
      // 若离开的是当前画手，先确定下一位（在移除其顺序前计算）
      const newDrawer = wasDrawer ? nextDrawer(room, user) : null

      room.players.delete(user)
      room.turnOrder = room.turnOrder.filter((p) => p !== user)
      // 同时清除其个人数据，避免昵称被永久占用
      room.scoreboard = room.scoreboard.filter((s) => s.user !== user)

      const sysMsg: ChatMessage = {
        user: 'system',
        text: `${user} 离开了房间（${reason}）`,
        time: nowStr(),
        isSystem: true,
      }
      room.chat.push(sysMsg)
      broadcastToRoom(room.id, { type: 'chat_msg', msg: sysMsg })

      if (wasDrawer) {
        room.currentDrawer = newDrawer
        room.state = 'lobby'
        room.answer = null
        room.lastWinner = null
      }

      broadcastToRoom(room.id, { type: 'room_state', state: publicRoomState(room) })
    }
  }
}

// ============================================================
// 消息分发
// ============================================================
function handleMessage(ws: WSContext<WebSocket>, data: any) {
  const info = clients.get(ws)
  const type = String(data.type || '')

  // 只有 login 允许未登录
  if (type !== 'login' && !info) {
    send(ws, { type: 'error', text: '请先登录', time: nowStr() })
    return
  }

  // 任何已登录消息都刷新心跳
  if (info) info.lastHeartbeat = Date.now()

  switch (type) {
    case 'login':
      return handleLogin(ws, data)
    case 'logout':
      return handleLogout(ws)
    case 'ping':
      return handlePing(ws)
    case 'draw_stroke':
      return handleDrawStroke(ws, data)
    case 'clear_canvas':
      return handleClearCanvas(ws)
    case 'set_answer':
      return handleSetAnswer(ws, data)
    case 'start_drawing':
      return handleStartDrawing(ws)
    case 'submit_answer':
      return handleSubmitAnswer(ws, data)
    case 'chat':
      return handleChat(ws, data)
    default:
      send(ws, { type: 'error', text: `未知消息类型: ${type}`, time: nowStr() })
  }
}

// ============================================================
// 消息处理器
// ============================================================
function handleLogin(ws: WSContext<WebSocket>, data: { user: string }) {
  const user = String(data.user || '').trim()
  if (!user) {
    send(ws, { type: 'error', text: '昵称不能为空', time: nowStr() })
    return
  }
  // 昵称不能与现存登录用户重复（基于同一连接的昵称可以替换）
  for (const [, ci] of clients) {
    if (ci.user === user) {
      send(ws, { type: 'error', text: '该昵称已被使用，请换一个', time: nowStr() })
      return
    }
  }
  const info: ClientInfo = { user, roomId: null, ws, lastHeartbeat: Date.now() }
  clients.set(ws, info)
  send(ws, { type: 'login_ok', user, onlineCount: clients.size })

  // 登录后自动加入唯一房间
  joinDefaultRoom(ws, info)
}

// 自动加入全局唯一房间
function joinDefaultRoom(ws: WSContext<WebSocket>, info: ClientInfo) {
  const room = rooms.get(DEFAULT_ROOM_ID)!
  const isNew = !room.players.has(info.user)
  room.players.add(info.user)
  ensureScore(room, info.user)
  if (isNew && !room.turnOrder.includes(info.user)) {
    room.turnOrder.push(info.user)
  }
  info.roomId = DEFAULT_ROOM_ID

  // 若该房间当前没有有效画手，新加入者即成为画手
  if (!room.currentDrawer || !room.players.has(room.currentDrawer)) {
    room.currentDrawer = info.user
    room.state = 'lobby'
    room.answer = null
    room.canvasHistory = ''
    room.lastWinner = null
  }

  const isDrawer = room.currentDrawer === info.user
  send(ws, { type: 'room_joined', roomId: DEFAULT_ROOM_ID, isDrawer })

  // 仅在用户是新加入时（而不是刷新重连）广播"加入"消息
  const alreadyPresent = Array.from(clients.values()).some(
    (ci) => ci !== info && ci.user === info.user && ci.roomId === DEFAULT_ROOM_ID
  )
  if (!alreadyPresent) {
    const sysMsg: ChatMessage = {
      user: 'system',
      text: `${info.user} 进入了房间`,
      time: nowStr(),
      isSystem: true,
    }
    room.chat.push(sysMsg)
    broadcastToRoom(room.id, { type: 'chat_msg', msg: sysMsg })
  }
  broadcastToRoom(room.id, { type: 'room_state', state: publicRoomState(room) })
}

function handleLogout(ws: WSContext<WebSocket>) {
  removeClient(ws, '主动退出')
  send(ws, { type: 'logged_out' })
}

function handlePing(ws: WSContext<WebSocket>) {
  // 心跳：刷新时间已由 handleMessage 统一处理，这里回 pong 维持连接健康
  send(ws, { type: 'pong', time: nowStr() })
}

function handleDrawStroke(ws: WSContext<WebSocket>, data: { stroke: string }) {
  const info = clients.get(ws)!
  const room = info.roomId && rooms.get(info.roomId)
  if (!room) return
  if (room.currentDrawer !== info.user) return // 只有当前画手能画
  if (room.state !== 'drawing') return
  room.canvasHistory += (room.canvasHistory ? '\n' : '') + String(data.stroke || '')
  broadcastToRoom(room.id, { type: 'canvas_stroke', stroke: data.stroke, from: info.user })
}

function handleClearCanvas(ws: WSContext<WebSocket>) {
  const info = clients.get(ws)!
  const room = info.roomId && rooms.get(info.roomId)
  if (!room) return
  if (room.currentDrawer !== info.user) return
  room.canvasHistory = ''
  broadcastToRoom(room.id, { type: 'canvas_clear' })
}

function handleSetAnswer(ws: WSContext<WebSocket>, data: { answer: string }) {
  const info = clients.get(ws)!
  const room = info.roomId && rooms.get(info.roomId)
  if (!room) return
  if (room.currentDrawer !== info.user) return
  const answer = String(data.answer || '').trim()
  if (!answer) {
    send(ws, { type: 'error', text: '答案不能为空', time: nowStr() })
    return
  }
  room.answer = answer
  send(ws, { type: 'system', text: `答案已设置（仅你可见）：${answer}`, time: nowStr() })
}

function handleStartDrawing(ws: WSContext<WebSocket>) {
  const info = clients.get(ws)!
  const room = info.roomId && rooms.get(info.roomId)
  if (!room) return
  if (room.currentDrawer !== info.user) return
  if (!room.answer) {
    send(ws, { type: 'error', text: '请先设置答案', time: nowStr() })
    return
  }
  room.state = 'drawing'
  room.canvasHistory = ''
  room.lastWinner = null
  const sysMsg: ChatMessage = {
    user: 'system',
    text: '本轮开始！请在输入框中猜测答案。',
    time: nowStr(),
    isSystem: true,
    inChat: false,
  }
  room.chat.push(sysMsg)
  broadcastToRoom(room.id, { type: 'chat_msg', msg: sysMsg })
  broadcastToRoom(room.id, { type: 'room_state', state: publicRoomState(room) })
  broadcastToRoom(room.id, { type: 'canvas_clear' })
  broadcastToRoom(room.id, { type: 'drawing_start', drawer: room.currentDrawer })
}

function handleSubmitAnswer(ws: WSContext<WebSocket>, data: { text: string }) {
  const info = clients.get(ws)!
  const room = info.roomId && rooms.get(info.roomId)
  if (!room) return
  const text = String(data.text || '').trim()
  if (!text) return

  // 1) 先作为聊天消息广播（画手也能看到玩家在猜什么）
  const chatMsg: ChatMessage = { user: info.user, text, time: nowStr() }
  room.chat.push(chatMsg)
  broadcastToRoom(room.id, { type: 'chat_msg', msg: chatMsg })

  // 2) 答案判定
  tryAnswer(room, info.user, text)
}

function handleChat(ws: WSContext<WebSocket>, data: { text: string }) {
  const info = clients.get(ws)!
  const room = info.roomId && rooms.get(info.roomId)
  if (!room) return
  const text = String(data.text || '').trim()
  if (!text) return
  const chatMsg: ChatMessage = { user: info.user, text, time: nowStr() }
  room.chat.push(chatMsg)
  broadcastToRoom(room.id, { type: 'chat_msg', msg: chatMsg })

  // 3) 聊天消息也要做答案判定（猜对同样计分并结束本轮）
  tryAnswer(room, info.user, text)
}

// 统一的答案判定：drawing 状态、已有答案、非画手、本轮尚未结束
function tryAnswer(room: Room, user: string, text: string) {
  if (room.state !== 'drawing') return
  if (!room.answer) return
  if (user === room.currentDrawer) return
  if (room.lastWinner) return // 一轮只算第一个

  const ans = room.answer.trim().toLowerCase()
  if (text.trim().toLowerCase() !== ans) return

  room.lastWinner = user
  ensureScore(room, user)
  const entry = room.scoreboard.find((s) => s.user === user)!
  entry.score += 1
  room.scoreboard.sort((a, b) => b.score - a.score)
  room.state = 'roundOver'

  const sysOk: ChatMessage = {
    user: 'system',
    text: `🎉 ${user} 猜对了！答案是「${room.answer}」，+1 分。`,
    time: nowStr(),
    isSystem: true,
    isCorrect: true,
    inChat: false,
  }
  room.chat.push(sysOk)
  broadcastToRoom(room.id, { type: 'chat_msg', msg: sysOk })
  broadcastToRoom(room.id, { type: 'round_over', winner: user, answer: room.answer })

  // 上一位画手结束 → 自动轮换到下一位画手（按进入房间顺序）
  advanceToNextDrawer(room)
}

// 结算后轮换到下一位画手
function advanceToNextDrawer(room: Room) {
  const next = nextDrawer(room, room.currentDrawer)
  room.currentDrawer = next
  room.state = 'lobby'
  room.answer = null
  room.lastWinner = null
  // 画板保留上一轮的画作，直到新画手开启本轮时清空

  if (next) {
    const sysMsg: ChatMessage = {
      user: 'system',
      text: `轮到 ${next} 出题作画，请在下方设置答案后开启画板。`,
      time: nowStr(),
      isSystem: true,
    }
    room.chat.push(sysMsg)
    broadcastToRoom(room.id, { type: 'chat_msg', msg: sysMsg })
  }
  broadcastToRoom(room.id, { type: 'room_state', state: publicRoomState(room) })
}

// ============================================================
// 心跳扫描：清除超过 10 分钟无任何消息的卡死连接
// ============================================================
setInterval(() => {
  const now = Date.now()
  const stale: WSContext<WebSocket>[] = []
  for (const [ws, info] of clients) {
    if (now - info.lastHeartbeat > HEARTBEAT_TIMEOUT) {
      stale.push(ws)
    }
  }
  for (const ws of stale) {
    removeClient(ws, '心跳超时')
  }
}, HEARTBEAT_CHECK_INTERVAL)

// ============================================================
// 启动服务器
// ============================================================
try {
  const nets = Deno.networkInterfaces?.() ?? []
  const lanIps: string[] = []
  for (const net of nets) {
    if (net.family === 'IPv4') lanIps.push(net.address)
  }
  if (lanIps.length) {
    console.log('本机局域网 IP：')
    lanIps.forEach((ip) => console.log(`  http://${ip}:8000`))
  }
} catch (e) {
  console.log('（无法读取局域网 IP，缺少 --allow-sys 权限；可用 localhost 访问）')
}

Deno.serve({ port: Number(Deno.env.get('PORT') ?? '8000') }, app.fetch)
