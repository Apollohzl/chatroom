/* ============================================================
 * 你画我猜 · 前端主脚本（单房间版）
 * 单页结构：登录面板 + 游戏区；登录后自动进入唯一房间。
 * ============================================================ */
(function () {
  'use strict'

  // ---------- 全局状态 ----------
  const ws = { conn: null } // WebSocket 连接
  const user = { name: localStorage.getItem('chat-username') || '' }
  let currentRoomId = null
  let isDrawer = false
  let stateDrawer = '' // 当前画手昵称（用于聊天前缀）

  // ---------- 颜色（画板状态） ----------
  const boardState = {
    drawing: false,
    color: '#1f2937',
    canDraw: false, // 只有当前画手 + 状态 = drawing 才允许绘画
    lastX: 0,
    lastY: 0,
  }

  // ---------- 小工具 ----------
  function $(id) {
    return document.getElementById(id)
  }
  function qs(sel, root) {
    return (root || document).querySelector(sel)
  }
  function qsa(sel, root) {
    return Array.from((root || document).querySelectorAll(sel))
  }
  function send(obj) {
    if (ws.conn && ws.conn.readyState === 1) {
      ws.conn.send(JSON.stringify(obj))
    }
  }

  function connect(onOpen) {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const conn = new WebSocket(protocol + '://' + location.host + '/ws')
    conn.onopen = function () {
      if (onOpen) onOpen(conn)
    }
    conn.onmessage = function (evt) {
      let data
      try { data = JSON.parse(evt.data) } catch (e) { return }
      if (!data) return
      onMessage(evt)
    }
    conn.onclose = function () {
      showSystem('连接已断开，正在重连…')
      setTimeout(function () {
        connect(function () {
          // 重连后自动登录
          if (user.name) send({ type: 'login', user: user.name })
        })
      }, 1200)
    }
    ws.conn = conn
  }

  function showSystem(text) {
    // 登录页没有聊天框，游戏区有
    const chat = $('chat')
    if (!chat) return
    const div = document.createElement('div')
    div.className = 'message system-message'
    div.textContent = text
    chat.appendChild(div)
    chat.scrollTop = chat.scrollHeight
  }

  // ============================
  // 登录面板
  // ============================
  function initLogin() {
    const loginSection = $('login-section')
    const gameSection = $('game-section')
    const inputUsername = $('username')
    const loginBtn = $('login-btn')

    // 已经有用户名：自动连接并登录
    if (user.name) {
      connect(function () {
        send({ type: 'login', user: user.name })
      })
    }

    loginBtn.addEventListener('click', function () {
      const v = inputUsername.value.trim()
      if (!v) return alert('请输入昵称')
      user.name = v
      localStorage.setItem('chat-username', user.name)
      // 连接未建立则先建立，建立后自动在 onopen 里登录；已建立则直接登录
      if (!ws.conn || ws.conn.readyState !== 1) {
        connect(function () {
          send({ type: 'login', user: user.name })
        })
      } else {
        send({ type: 'login', user: user.name })
      }
    })

    inputUsername.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') loginBtn.click()
    })

    // 退出登录：清除本地昵称，回到登录面板（连接保留，便于再次登录）
    const logoutBtn = $('logout-btn')
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        localStorage.removeItem('chat-username')
        user.name = ''
        send({ type: 'logout' })
        if (gameSection) gameSection.classList.add('hidden')
        if (loginSection) loginSection.classList.remove('hidden')
      })
    }

    // 心跳：每 30 秒发送一次 ping
    setInterval(function () {
      send({ type: 'ping' })
    }, 30000)
  }

  // ============================
  // 游戏区
  // ============================
  function initGamePage() {
    const backBtn = null // 已移除「返回大厅」
    const canvasToolbar = $('canvas-toolbar')
    const colorPalette = $('color-palette')
    const clearBtn = $('clear-canvas-btn')
    const canvas = $('board')
    const ctx = canvas.getContext('2d')
    const overlay = $('canvas-overlay')
    const hostAnswerBar = $('host-answer-bar')
    const answerInput = $('answer-input')
    const startDrawingBtn = $('start-drawing-btn')
    const leaderboard = $('leaderboard')
    const chatBox = $('chat')
    const chatInput = $('chat-input')
    const chatSend = $('chat-send')
    const roomHostEl = $('room-host')
    const gameStateEl = $('game-state')
    const playerCountEl = $('player-count')

    // 自适应正方形
    function fitCanvas() {
      const wrap = canvas.parentElement
      const size = Math.min(wrap.clientWidth, window.innerHeight - 320)
      canvas.style.width = size + 'px'
      canvas.style.height = size + 'px'
    }
    window.addEventListener('resize', fitCanvas)
    fitCanvas()

    // 颜色选择
    qsa('.color-dot', colorPalette).forEach(function (btn) {
      btn.addEventListener('click', function () {
        qsa('.color-dot', colorPalette).forEach(function (b) {
          b.classList.remove('active')
        })
        btn.classList.add('active')
        boardState.color = btn.getAttribute('data-color') || '#1f2937'
      })
    })

    // 清空画板
    clearBtn.addEventListener('click', function () {
      send({ type: 'clear_canvas' })
    })

    // 当前画手：设置答案
    answerInput.addEventListener('blur', function () {
      if (answerInput.value.trim()) send({ type: 'set_answer', answer: answerInput.value })
    })
    startDrawingBtn.addEventListener('click', function () {
      const val = answerInput.value.trim()
      if (!val) return alert('请先填写一个答案')
      startDrawingBtn.disabled = true
      startDrawingBtn.textContent = '正在开启…'
      send({ type: 'set_answer', answer: val })
      send({ type: 'start_drawing' })
    })

    // 聊天（也是猜词入口）
    chatSend.addEventListener('click', function () {
      const v = chatInput.value.trim().slice(0, 50)
      if (!v) return
      send({ type: 'chat', text: v })
      chatInput.value = ''
    })
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') chatSend.click()
    })

    // ---------- 画板事件 ----------
    function canvasPoint(evt) {
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const touch = evt.touches && evt.touches[0]
      const clientX = touch ? touch.clientX : evt.clientX
      const clientY = touch ? touch.clientY : evt.clientY
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      }
    }

    function onCanvasDown(evt) {
      if (!boardState.canDraw) return
      evt.preventDefault()
      const p = canvasPoint(evt)
      boardState.drawing = true
      boardState.lastX = p.x
      boardState.lastY = p.y
      drawLocal(p.x, p.y, p.x, p.y)
    }
    function onCanvasMove(evt) {
      if (!boardState.drawing || !boardState.canDraw) return
      evt.preventDefault()
      const p = canvasPoint(evt)
      drawLocal(boardState.lastX, boardState.lastY, p.x, p.y)
      boardState.lastX = p.x
      boardState.lastY = p.y
    }
    function onCanvasUp(evt) {
      boardState.drawing = false
    }

    canvas.addEventListener('mousedown', onCanvasDown)
    canvas.addEventListener('mousemove', onCanvasMove)
    canvas.addEventListener('mouseup', onCanvasUp)
    canvas.addEventListener('mouseleave', onCanvasUp)
    canvas.addEventListener('touchstart', onCanvasDown, { passive: false })
    canvas.addEventListener('touchmove', onCanvasMove, { passive: false })
    canvas.addEventListener('touchend', onCanvasUp)

    // 本地绘制并发送 stroke
    function drawLocal(x1, y1, x2, y2) {
      const isEraser = boardState.color === 'eraser'
      ctx.save()
      ctx.lineWidth = isEraser ? 20 : 5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (isEraser) {
        ctx.globalCompositeOperation = 'destination-out'
      } else {
        ctx.strokeStyle = boardState.color
      }
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.restore()

      send({
        type: 'draw_stroke',
        stroke: [x1, y1, x2, y2, boardState.color].join(','),
      })
    }

    // 根据服务器传来的 stroke 重放
    function playRemoteStroke(stroke) {
      const parts = String(stroke).split(',')
      if (parts.length < 5) return
      const x1 = parseFloat(parts[0])
      const y1 = parseFloat(parts[1])
      const x2 = parseFloat(parts[2])
      const y2 = parseFloat(parts[3])
      const color = parts[4]
      const isEraser = color === 'eraser'
      ctx.save()
      ctx.lineWidth = isEraser ? 20 : 5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (isEraser) {
        ctx.globalCompositeOperation = 'destination-out'
      } else {
        ctx.strokeStyle = color
      }
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.restore()
    }
    function clearCanvas() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }

    // ---------- 渲染状态 ----------
    function renderState(state) {
      roomHostEl.textContent = state.host || '—'
      playerCountEl.textContent = state.players.length
      stateDrawer = state.host || '' // 供 appendChat 判断 [画手] 前缀

      // 游戏状态标签
      if (state.state === 'drawing') {
        gameStateEl.textContent = '进行中'
        gameStateEl.className = 'state-tag drawing'
      } else if (state.state === 'roundOver') {
        gameStateEl.textContent = '本轮结束'
        gameStateEl.className = 'state-tag roundOver'
      } else {
        gameStateEl.textContent = '等待中'
        gameStateEl.className = 'state-tag lobby'
      }

      // 当前画手身份
      isDrawer = !!user.name && user.name === state.host
      if (isDrawer) {
        canvasToolbar.style.display = 'flex'
        hostAnswerBar.style.display = 'flex'
        boardState.canDraw = state.state === 'drawing'
      } else {
        canvasToolbar.style.display = 'none'
        hostAnswerBar.style.display = 'none'
        boardState.canDraw = false
      }

      // overlay 文案
      if (state.state === 'drawing') {
        overlay.style.display = 'none'
      } else if (state.state === 'roundOver') {
        overlay.style.display = 'block'
        overlay.textContent = '本轮已结束，等待下一位画手…'
      } else {
        overlay.style.display = 'block'
        overlay.textContent = isDrawer
          ? '请在下方输入一个答案并点击「确认并开启画板」'
          : '等待 ' + (state.host || '画手') + ' 出题…'
      }

      // 重放历史笔画
      if (state.canvasHistory) {
        clearCanvas()
        String(state.canvasHistory).split('\n').forEach(function (line) {
          if (line) playRemoteStroke(line)
        })
      } else {
        clearCanvas()
      }

      // 排行榜（展示全部玩家，包括当前画手）
      leaderboard.innerHTML = ''
      const entries = state.scoreboard || []
      if (!entries.length) {
        const empty = document.createElement('li')
        empty.className = 'empty'
        empty.textContent = '暂无数据'
        leaderboard.appendChild(empty)
      } else {
        entries.forEach(function (e, idx) {
          const li = document.createElement('li')
          li.innerHTML =
            '<span class="rank">' +
            (idx + 1) +
            '</span>' +
            '<span class="name">' +
            e.user +
            '</span>' +
            '<span class="score">' +
            e.score +
            ' 分</span>'
          leaderboard.appendChild(li)
        })
      }

      // 聊天历史（仅在首次收到 state 时回填一次）
      if (state.chat && chatBox.childElementCount <= 1) {
        state.chat.forEach(function (m) {
          appendChat(m)
        })
      }
    }

    function appendChat(m) {
      if (m.inChat === false) return
      const div = document.createElement('div')
      div.className = 'message ' + (m.isSystem ? 'system-message' : 'other-message')
      if (m.isCorrect) div.classList.add('correct')
      if (m.isSystem) {
        div.textContent = m.text
      } else {
        const prefix = m.user === stateDrawer ? '[画手]' : ''
        div.textContent = (prefix ? prefix + ' ' : '') + m.user + '：' + m.text
      }
      chatBox.appendChild(div)
      chatBox.scrollTop = chatBox.scrollHeight
    }

    // 暴露给 onMessage 使用
    window.__playRemoteStroke = playRemoteStroke
    window.__clearCanvas = clearCanvas
    window.__renderState = renderState
    window.__appendChat = appendChat
  }

  // ============================
  // onMessage 统一处理
  // ============================
  function onMessage(evt) {
    let data
    try {
      data = JSON.parse(evt.data)
    } catch (e) {
      return
    }
    if (!data || !data.type) return

    // 登录成功：保存用户名
    if (data.type === 'login_ok') {
      user.name = data.user
    }

    // 加入房间：显示游戏区
    if (data.type === 'room_joined') {
      currentRoomId = data.roomId
      isDrawer = !!data.isDrawer
      const loginSection = $('login-section')
      const gameSection = $('game-section')
      if (loginSection) loginSection.classList.add('hidden')
      if (gameSection) gameSection.classList.remove('hidden')
    }

    if (data.type === 'room_state' && window.__renderState) {
      window.__renderState(data.state)
      if (isDrawer && data.state && data.state.state === 'drawing') {
        const btn = $('start-drawing-btn')
        if (btn) {
          btn.disabled = false
          btn.textContent = '确认并开启画板'
        }
      }
    }

    if (data.type === 'canvas_stroke' && window.__playRemoteStroke) {
      if (data.from === user.name) return // 自己画的已在本地绘制过，避免重复
      window.__playRemoteStroke(data.stroke)
    }
    if (data.type === 'canvas_clear' && window.__clearCanvas) {
      window.__clearCanvas()
    }

    if (data.type === 'chat_msg' && window.__appendChat) {
      window.__appendChat(data.msg)
    }

    if (data.type === 'round_over') {
      showSystem('🎉 ' + data.winner + ' 猜对了答案「' + data.answer + '」')
    }

    if (data.type === 'drawing_start') {
      showSystem(data.drawer + ' 开始绘画，请在输入框中猜测答案！')
    }

    if (data.type === 'system') {
      showSystem(data.text)
    }

    if (data.type === 'error') {
      alert(data.text || '发生错误')
      if (isDrawer) {
        const btn = $('start-drawing-btn')
        if (btn) {
          btn.disabled = false
          btn.textContent = '确认并开启画板'
        }
      }
    }
  }

  // ============================
  // 隐藏入口：连续点击「猜词游戏」10 次解锁后台
  // ============================
  function initSecretEntry() {
    const el = $('secret-entry')
    if (!el) return
    let clicks = 0
    let unlocked = false
    const NEED = 10
    el.addEventListener('click', function () {
      if (unlocked) return
      clicks++
      // 轻微反馈，保持隐蔽
      el.style.transform = 'scale(0.92)'
      setTimeout(function () {
        if (el) el.style.transform = ''
      }, 100)
      if (clicks >= NEED) {
        unlocked = true
        fetch('/admin/grant', { method: 'POST', credentials: 'same-origin' })
          .then(function (r) {
            if (r.ok) {
              showUnlockToast()
              setTimeout(function () {
                window.location.href = '/admin'
              }, 700)
            } else {
              unlocked = false
              clicks = 0
            }
          })
          .catch(function () {
            unlocked = false
            clicks = 0
          })
      }
    })
  }

  function showUnlockToast() {
    let t = $('secret-toast')
    if (!t) {
      t = document.createElement('div')
      t.id = 'secret-toast'
      t.className = 'secret-toast'
      document.body.appendChild(t)
    }
    t.textContent = '🔓 已解锁后台入口…'
    t.classList.add('show')
  }

  // ============================
  // 启动
  // ============================
  document.addEventListener('DOMContentLoaded', function () {
    initLogin()
    initGamePage()
    initSecretEntry()
  })
})()
