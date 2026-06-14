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
  host: string
  players: Set<string>
  state: 'lobby' | 'drawing' | 'roundOver'
  answer: string | null
  currentDrawer: string | null
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
const rooms = new Map<string, Room>()

// ============================================================
// 工具函数
// ============================================================
function genRoomId(): string {
  // 4 位数字，尽量避免碰撞
  let id = ''
  do {
    id = String(Math.floor(1000 + Math.random() * 9000))
  } while (rooms.has(id))
  return id
}

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

function publicRoomList(kw?: string) {
  const list: Array<{ id: string; host: string; playerCount: number; state: Room['state'] }> = []
  const lower = (kw || '').trim().toLowerCase()
  for (const room of rooms.values()) {
    if (lower && !room.id.includes(lower) && !room.host.toLowerCase().includes(lower)) continue
    list.push({
      id: room.id,
      host: room.host,
      playerCount: room.players.size,
      state: room.state,
    })
  }
  // 按创建时间倒序（最近的在前）
  return list.sort((a, b) => (rooms.get(b.id)!.createdAt - rooms.get(a.id)!.createdAt))
}

function publicRoomState(room: Room) {
  return {
    id: room.id,
    host: room.host,
    players: Array.from(room.players),
    state: room.state,
    currentDrawer: room.currentDrawer,
    canvasHistory: room.canvasHistory,
    scoreboard: room.scoreboard,
    chat: room.chat.slice(-200),
    hasAnswer: !!room.answer,
  }
}

function getRoomByUser(user: string): Room | null {
  for (const room of rooms.values()) {
    if (room.players.has(user) || room.host === user) return room
  }
  return null
}

function ensureScore(room: Room, user: string) {
  if (!room.scoreboard.find((s) => s.user === user)) {
    room.scoreboard.push({ user, score: 0 })
  }
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

// 首页：登录 + 创建/加入房间 + 房间大厅
app.get('/', (c: Context) => {
  return c.html(
    <Layout title="你画我猜 · 大厅">
      <div id="app">
        {/* 登录面板 */}
        <section id="login-section" class="panel">
          <h1 class="brand">你画我猜</h1>
          <p class="subtitle">实时多人协作猜词游戏</p>
          <div class="input-row">
            <input id="username" autocomplete="off" placeholder="输入你的昵称" />
            <button id="login-btn" class="primary">进入大厅</button>
          </div>
        </section>

        {/* 大厅（登录后显示） */}
        <section id="hall-section" class="panel hidden">
          <header class="hall-header">
            <div>
              <h2>大厅</h2>
              <small>
                你好，<span id="me">—</span>
              </small>
            </div>
            <button id="logout-btn" class="ghost">退出</button>
          </header>

          <div class="hall-actions">
            <button id="create-btn" class="primary">创建房间</button>
            <div class="join-row">
              <input id="join-id" placeholder="输入房间 ID 加入" />
              <button id="join-btn">加入</button>
            </div>
            <div class="search-row">
              <input id="search-kw" placeholder="搜索房间 / 房主昵称" />
              <button id="search-btn">搜索</button>
            </div>
          </div>

          <div class="hall-grid">
            <div class="hall-grid-head">
              <h3>在线房间</h3>
              <small><span id="room-count">0</span> 个房间 · <span id="online-count">-</span> 人在线</small>
            </div>
            <div id="room-list" class="room-list">
              <div class="empty">暂无房间，创建一个吧～</div>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  )
})

// 游戏页
app.get('/room/:id', (c: Context) => {
  const roomId = c.req.param('id')
  return c.html(
    <Layout title={`房间 ${roomId} · 你画我猜`}>
      <div id="game-app" data-room={roomId}>
        {/* 顶部栏 */}
        <header class="game-header">
          <div class="left">
            <button class="ghost" id="back-btn">← 返回大厅</button>
            <div class="room-info">
              房间 <b id="room-id">{roomId}</b>
              <small>
                房主：<span id="room-host">—</span>
              </small>
            </div>
          </div>
          <div class="center">
            <span id="game-state" class="state-tag">等待中</span>
            <small>在线 <span id="player-count">0</span> 人</small>
          </div>
          <div class="right" id="host-controls" style={{ display: 'none' }}>
            <button id="close-room-btn" class="danger">关闭房间</button>
          </div>
        </header>

        {/* 主体：左侧画板 + 右侧排行榜 */}
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
              <div id="canvas-overlay" class="canvas-overlay">等待房主开始本轮…</div>
            </div>

            {/* 答案输入区（房主） */}
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
              <small>（不含房主）</small>
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
      </div>
    </Layout>
  )
})

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
        handleDisconnect(ws)
      },
      onError(_evt, ws) {
        handleDisconnect(ws)
      },
    }
  })
)

function handleDisconnect(ws: WSContext<WebSocket>) {
  const info = clients.get(ws)
  if (!info) return
  clients.delete(ws)

  if (info.roomId) {
    const room = rooms.get(info.roomId)
    if (room) {
      room.players.delete(info.user)
      // 只在该用户没有其他连接时才广播"离开"消息
      const stillOnline = Array.from(clients.values()).some((ci) => ci.user === info.user && ci.roomId === info.roomId)
      if (!stillOnline) {
        const sysMsg: ChatMessage = { user: 'system', text: `${info.user} 离开了房间`, time: nowStr(), isSystem: true }
        room.chat.push(sysMsg)
        broadcastToRoom(room.id, { type: 'chat_msg', msg: sysMsg })
      }
      // 始终同步最新状态
      broadcastToRoom(room.id, { type: 'room_state', state: publicRoomState(room) })
    }
  }

  // 无论如何都推送最新大厅列表
  broadcastHallList()
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

  switch (type) {
    case 'login':
      return handleLogin(ws, data)
    case 'list_rooms':
      return handleListRooms(ws, data)
    case 'create_room':
      return handleCreateRoom(ws)
    case 'join_room':
      return handleJoinRoom(ws, data)
    case 'leave_room':
      return handleLeaveRoom(ws)
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
    case 'close_room':
      return handleCloseRoom(ws)
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
  clients.set(ws, { user, roomId: null, ws })
  send(ws, { type: 'login_ok', user, onlineCount: clients.size })
  broadcastHallList()
}

function broadcastHallList(kw?: string, toWs?: WSContext<WebSocket>) {
  const payload = { type: 'room_list', rooms: publicRoomList(kw), onlineCount: clients.size }
  if (toWs) {
    send(toWs, payload)
    return
  }
  // 推送给所有处于大厅 / 已登录用户
  for (const [ws, ci] of clients) {
    if (!ci.roomId) send(ws, payload)
  }
}

function handleListRooms(ws: WSContext<WebSocket>, data: { kw?: string }) {
  send(ws, { type: 'room_list', rooms: publicRoomList(data.kw) })
}

function handleCreateRoom(ws: WSContext<WebSocket>) {
  const info = clients.get(ws)!
  if (info.roomId) {
    send(ws, { type: 'error', text: '你已经在一个房间中', time: nowStr() })
    return
  }
  const id = genRoomId()
  const room: Room = {
    id,
    host: info.user,
    players: new Set([info.user]),
    state: 'lobby',
    answer: null,
    currentDrawer: info.user,
    canvasHistory: '',
    lastWinner: null,
    scoreboard: [],
    chat: [{ user: 'system', text: `房间 ${id} 已创建，欢迎 ${info.user}！`, time: nowStr(), isSystem: true }],
    createdAt: Date.now(),
  }
  rooms.set(id, room)
  info.roomId = id
  send(ws, { type: 'room_joined', roomId: id, isHost: true })
  send(ws, { type: 'room_state', state: publicRoomState(room) })
  broadcastHallList()
}

function handleJoinRoom(ws: WSContext<WebSocket>, data: { roomId: string }) {
  const info = clients.get(ws)!
  const roomId = String(data.roomId || '').trim()
  if (!roomId) {
    send(ws, { type: 'error', text: '请提供房间 ID', time: nowStr() })
    return
  }
  // 如果该连接已经在目标房间里，直接返回状态即可（支持刷新后自动重建）
  if (info.roomId === roomId) {
    const room = rooms.get(roomId)
    if (room) {
      send(ws, { type: 'room_joined', roomId, isHost: info.user === room.host })
      send(ws, { type: 'room_state', state: publicRoomState(room) })
    }
    return
  }
  // 如果之前在别的房间，先离开
  if (info.roomId) {
    const prev = rooms.get(info.roomId)
    if (prev) prev.players.delete(info.user)
  }
  const room = rooms.get(roomId)
  if (!room) {
    send(ws, { type: 'error', text: '房间不存在或已关闭', time: nowStr() })
    return
  }
  room.players.add(info.user)
  ensureScore(room, info.user)
  info.roomId = roomId
  // 告知本人（是否为房主：房主重连也能恢复）
  const isHost = info.user === room.host
  send(ws, { type: 'room_joined', roomId, isHost })
  send(ws, { type: 'room_state', state: publicRoomState(room) })
  // 只在用户是新加入时（而不是刷新重连）广播"加入"消息
  const alreadyPresent = Array.from(clients.values()).some((ci) => ci !== info && ci.user === info.user && ci.roomId === roomId)
  if (!alreadyPresent) {
    const sysMsg: ChatMessage = { user: 'system', text: `${info.user} 加入了房间`, time: nowStr(), isSystem: true }
    room.chat.push(sysMsg)
    broadcastToRoom(roomId, { type: 'chat_msg', msg: sysMsg })
  }
  broadcastToRoom(roomId, { type: 'room_state', state: publicRoomState(room) })
  broadcastHallList()
}

function handleLeaveRoom(ws: WSContext<WebSocket>) {
  const info = clients.get(ws)!
  if (!info.roomId) return
  const room = rooms.get(info.roomId)
  info.roomId = null
  if (!room) return

  if (room.host === info.user) {
    // 房主离开 = 关闭房间（handleDisconnect 也处理了，这里保持一致）
    broadcastToRoom(room.id, { type: 'system', text: `房主 ${info.user} 已离开，房间解散。`, time: nowStr() })
    broadcastToRoom(room.id, { type: 'room_closed', reason: 'host_left' })
    for (const [, ci] of clients) {
      if (ci.roomId === room.id) ci.roomId = null
    }
    rooms.delete(room.id)
  } else {
    room.players.delete(info.user)
    ensureScore(room, info.user)
    const sysMsg: ChatMessage = { user: 'system', text: `${info.user} 离开了房间`, time: nowStr(), isSystem: true }
    room.chat.push(sysMsg)
    broadcastToRoom(room.id, { type: 'chat_msg', msg: sysMsg })
    broadcastToRoom(room.id, { type: 'room_state', state: publicRoomState(room) })
  }
  broadcastHallList()
}

function handleDrawStroke(ws: WSContext<WebSocket>, data: { stroke: string }) {
  const info = clients.get(ws)!
  const room = info.roomId && rooms.get(info.roomId)
  if (!room) return
  if (room.host !== info.user) return // 只有房主能画
  if (room.state !== 'drawing') return
  room.canvasHistory += (room.canvasHistory ? '\n' : '') + String(data.stroke || '')
  broadcastToRoom(room.id, { type: 'canvas_stroke', stroke: data.stroke, from: info.user })
}

function handleClearCanvas(ws: WSContext<WebSocket>) {
  const info = clients.get(ws)!
  const room = info.roomId && rooms.get(info.roomId)
  if (!room) return
  if (room.host !== info.user) return
  room.canvasHistory = ''
  broadcastToRoom(room.id, { type: 'canvas_clear' })
}

function handleSetAnswer(ws: WSContext<WebSocket>, data: { answer: string }) {
  const info = clients.get(ws)!
  const room = info.roomId && rooms.get(info.roomId)
  if (!room) return
  if (room.host !== info.user) return
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
  if (room.host !== info.user) return
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
  broadcastToRoom(room.id, { type: 'drawing_start', drawer: room.host })
}

function handleSubmitAnswer(ws: WSContext<WebSocket>, data: { text: string }) {
  const info = clients.get(ws)!
  const room = info.roomId && rooms.get(info.roomId)
  if (!room) return
  const text = String(data.text || '').trim()
  if (!text) return

  // 1) 先作为聊天消息广播（房主也能看到玩家在猜什么）
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

// 统一的答案判定：drawing 状态、已有答案、非房主、本轮尚未结束
function tryAnswer(room: Room, user: string, text: string) {
  if (room.state !== 'drawing') return
  if (!room.answer) return
  if (user === room.host) return
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
  broadcastToRoom(room.id, { type: 'room_state', state: publicRoomState(room) })
}

function handleCloseRoom(ws: WSContext<WebSocket>) {
  const info = clients.get(ws)!
  const room = info.roomId && rooms.get(info.roomId)
  if (!room) return
  if (room.host !== info.user) return
  broadcastToRoom(room.id, { type: 'system', text: `房主已关闭房间 ${room.id}`, time: nowStr() })
  broadcastToRoom(room.id, { type: 'room_closed', reason: 'closed_by_host' })
  for (const [, ci] of clients) {
    if (ci.roomId === room.id) ci.roomId = null
  }
  rooms.delete(room.id)
  broadcastHallList()
}

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

Deno.serve(app.fetch)
