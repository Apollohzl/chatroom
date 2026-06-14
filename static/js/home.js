/* ============================================================
 * 你画我猜 · 前端主脚本
 * 同一脚本在首页/游戏页上都可用：根据 DOM 是否存在 #app / #game-app 决定。
 * ============================================================ */
(function () {
  'use strict'

  // ---------- 全局状态 ----------
  const ws = { conn: null } // WebSocket 连接
  const user = { name: localStorage.getItem('chat-username') || '' }
  let currentRoomId = null
  let isHost = false
  let stateHost = ''

  // ---------- 颜色（画板状态） ----------
  const boardState = {
    drawing: false,
    color: '#1f2937',
    canDraw: false, // 只有房主 + 状态 = drawing 才允许绘画
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
  // 标志：本连接是否已经收到 login_ok
  const connState = { loggedIn: false, autoJoinRoomId: null }

  function connect(onOpen) {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const conn = new WebSocket(protocol + '://' + location.host + '/ws')
    connState.loggedIn = false
    conn.onopen = function () {
      if (onOpen) onOpen(conn)
    }
    conn.onmessage = function (evt) {
      let data
      try { data = JSON.parse(evt.data) } catch (e) { return }
      if (!data) return
      // 一旦收到 login_ok：
      // - 如果大厅：允许按钮生效
      // - 如果游戏页：自动 join_room
      if (data.type === 'login_ok') {
        connState.loggedIn = true
        if (connState.autoJoinRoomId) {
          send({ type: 'join_room', roomId: connState.autoJoinRoomId })
        }
      }
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
    // 首页上没聊天框，游戏页上有
    const chat = $('chat')
    if (!chat) return
    const div = document.createElement('div')
    div.className = 'message system-message'
    div.textContent = text
    chat.appendChild(div)
    chat.scrollTop = chat.scrollHeight
  }

  // ============================
  // 首页 / 大厅
  // ============================
  function initHall() {
    const loginSection = $('login-section')
    const hallSection = $('hall-section')
    if (!loginSection || !hallSection) return

    const inputUsername = $('username')
    const loginBtn = $('login-btn')
    const logoutBtn = $('logout-btn')
    const createBtn = $('create-btn')
    const joinBtn = $('join-btn')
    const joinId = $('join-id')
    const searchKw = $('search-kw')
    const searchBtn = $('search-btn')
    const roomList = $('room-list')
    const roomCount = $('room-count')
    const onlineCountEl = $('online-count')

    // 已经有用户名：自动登录
    if (user.name) {
      connect(function () {
        send({ type: 'login', user: user.name })
      })
      showHall()
    }

    function showHall() {
      loginSection.classList.add('hidden')
      hallSection.classList.remove('hidden')
      $('me').textContent = user.name
    }

    loginBtn.addEventListener('click', function () {
      const v = inputUsername.value.trim()
      if (!v) return alert('请输入昵称')
      user.name = v
      localStorage.setItem('chat-username', user.name)
      connect(function () {
        send({ type: 'login', user: user.name })
      })
      showHall()
    })

    inputUsername.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') loginBtn.click()
    })

    logoutBtn.addEventListener('click', function () {
      localStorage.removeItem('chat-username')
      user.name = ''
      try {
        ws.conn && ws.conn.close()
      } catch (e) {}
      location.reload()
    })

    createBtn.addEventListener('click', function () {
      if (!connState.loggedIn) return alert('连接还在建立中，请稍后再试…')
      send({ type: 'create_room' })
    })

    joinBtn.addEventListener('click', function () {
      if (!connState.loggedIn) return alert('连接还在建立中，请稍后再试…')
      const id = joinId.value.trim()
      if (!id) return alert('请输入房间 ID')
      send({ type: 'join_room', roomId: id })
    })

    joinId.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') joinBtn.click()
    })

    searchBtn.addEventListener('click', function () {
      if (!connState.loggedIn) return
      send({ type: 'list_rooms', kw: searchKw.value.trim() })
    })

    searchKw.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') searchBtn.click()
    })

    // 进入页面时主动请求一次房间列表
    connect(function () {
      send({ type: 'login', user: user.name })
    })

    // 暴露给 onMessage：收到房间列表后更新 UI
    window.__updateRoomList = function (rooms) {
      roomList.innerHTML = ''
      if (!rooms.length) {
        const empty = document.createElement('div')
        empty.className = 'empty'
        empty.textContent = '暂无房间，创建一个吧～'
        roomList.appendChild(empty)
        roomCount.textContent = '0'
        return
      }
      roomCount.textContent = rooms.length
      rooms.forEach(function (r) {
        const card = document.createElement('div')
        card.className = 'room-card'
        const stateLabel =
          r.state === 'drawing'
            ? '进行中'
            : r.state === 'roundOver'
            ? '本轮结束'
            : '等待中'
        card.innerHTML =
          '<div class="room-card-head">' +
          '  <span class="room-id"># ' +
          r.id +
          '</span>' +
          '  <span class="state-tag ' +
          r.state +
          '">' +
          stateLabel +
          '</span>' +
          '</div>' +
          '<div class="room-card-body">' +
          '  <div>房主：<b>' +
          r.host +
          '</b></div>' +
          '  <div>在线：' +
          r.playerCount +
          ' 人</div>' +
          '</div>' +
          '<button class="primary join-card-btn">加入</button>'
        card.querySelector('.join-card-btn').addEventListener('click', function () {
          send({ type: 'join_room', roomId: r.id })
        })
        roomList.appendChild(card)
      })
    }
  }

  // ============================
  // 游戏页
  // ============================
  function initGamePage() {
    const gameApp = $('game-app')
    if (!gameApp) return
    const roomIdInDom = gameApp.getAttribute('data-room') || ''
    currentRoomId = roomIdInDom

    const backBtn = $('back-btn')
    const closeBtn = $('close-room-btn')
    const hostControls = $('host-controls')
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

    // 返回首页
    backBtn.addEventListener('click', function () {
      send({ type: 'leave_room' })
      location.href = '/'
    })

    closeBtn.addEventListener('click', function () {
      if (!confirm('确定要关闭房间吗？其他玩家将会被请出。')) return
      send({ type: 'close_room' })
      location.href = '/'
    })

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

    // 房主：设置答案
    answerInput.addEventListener('blur', function () {
      if (answerInput.value.trim()) send({ type: 'set_answer', answer: answerInput.value })
    })
    startDrawingBtn.addEventListener('click', function () {
      const val = answerInput.value.trim()
      if (!val) return alert('请先填写一个答案')
      // loading 状态
      startDrawingBtn.disabled = true
      startDrawingBtn.textContent = '正在开启…'
      send({ type: 'set_answer', answer: val })
      send({ type: 'start_drawing' })
    })

    // 聊天
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
      // 初始点先画一个小圈
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

      // 发送 stroke 到服务端
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
      roomHostEl.textContent = state.host
      playerCountEl.textContent = state.players.length
      stateHost = state.host // 供 appendChat 判断 [房主] 前缀
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

      // 房主身份
      isHost = user.name && user.name === state.host
      if (isHost) {
        hostControls.style.display = 'flex'
        canvasToolbar.style.display = 'flex'
        hostAnswerBar.style.display = 'flex'
        // 房主能在 drawing 状态下绘画
        boardState.canDraw = state.state === 'drawing'
      } else {
        hostControls.style.display = 'none'
        canvasToolbar.style.display = 'none'
        hostAnswerBar.style.display = 'none'
        boardState.canDraw = false // 玩家不能绘画
      }

      // overlay 文案
      if (state.state === 'drawing') {
        overlay.style.display = 'none'
      } else if (state.state === 'roundOver') {
        overlay.style.display = 'block'
        overlay.textContent = '本轮已结束，等待房主开启下一轮…'
      } else {
        overlay.style.display = 'block'
        overlay.textContent = isHost ? '请在下方输入一个答案并点击「确认并开启画板」' : '等待房主开始本轮…'
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

      // 排行榜（不含房主）
      leaderboard.innerHTML = ''
      const entries = (state.scoreboard || []).filter(function (e) {
        return e.user !== state.host
      })
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
        const prefix = m.user === stateHost ? '[房主]' : ''
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

    // ---------- 连接 ----------
    connect(function () {
      // 登录
      if (!user.name) {
        // 如果用户尚未登录（直接跳 /room/:id），要求在 prompt 中输入昵称
        const promptName = prompt('请输入你的昵称：')
        if (!promptName || !promptName.trim()) {
          alert('需要昵称才能进入房间，即将返回首页')
          setTimeout(function () { location.href = '/' }, 800)
          return
        }
        user.name = promptName.trim()
        localStorage.setItem('chat-username', user.name)
      }
      connState.autoJoinRoomId = currentRoomId
      send({ type: 'login', user: user.name })
    })
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
      if (onlineCountEl && data.onlineCount !== undefined) {
        onlineCountEl.textContent = data.onlineCount
      }
    }

    // 首页相关
    if (data.type === 'room_list' && window.__updateRoomList) {
      window.__updateRoomList(data.rooms)
      if (onlineCountEl && data.onlineCount !== undefined) {
        onlineCountEl.textContent = data.onlineCount
      }
    }

    // 通用：错误
    if (data.type === 'error') {
      alert(data.text || '发生错误')
      // 恢复房主按钮
      if (isHost && startDrawingBtn) {
        startDrawingBtn.disabled = false
        startDrawingBtn.textContent = '确认并开启画板'
      }
    }
    if (data.type === 'system') {
      showSystem(data.text)
    }

    // 加入房间：跳转到游戏页
    if (data.type === 'room_joined') {
      // 如果当前已经在该 roomId 的页面上，不跳转
      const currentPath = location.pathname
      const expected = '/room/' + data.roomId
      if (currentPath !== expected) {
        location.href = expected
        return
      }
      currentRoomId = data.roomId
    }

    // 房间状态（游戏页）
    if (data.type === 'room_state' && window.__renderState) {
      window.__renderState(data.state)
      // drawing 状态时恢复按钮（可能是刚完成 start_drawing）
      if (isHost && data.state && data.state.state === 'drawing') {
        startDrawingBtn.disabled = false
        startDrawingBtn.textContent = '确认并开启画板'
      }
    }

    // 画板 stroke / clear
    if (data.type === 'canvas_stroke' && window.__playRemoteStroke) {
      // 房主自己也会收到广播；但本地已经画过 → 检查 from 避免重复
      if (data.from === user.name) return
      window.__playRemoteStroke(data.stroke)
    }
    if (data.type === 'canvas_clear' && window.__clearCanvas) {
      window.__clearCanvas()
    }

    // 聊天消息
    if (data.type === 'chat_msg' && window.__appendChat) {
      window.__appendChat(data.msg)
    }

    // 本轮结束
    if (data.type === 'round_over') {
      showSystem('🎉 ' + data.winner + ' 猜对了答案「' + data.answer + '」')
    }

    // 开始绘画
    if (data.type === 'drawing_start') {
      showSystem(data.drawer + ' 开始绘画，请在输入框中猜测答案！')
    }

    // 房间被关闭
    if (data.type === 'room_closed') {
      alert('房间已关闭，将返回大厅。')
      setTimeout(function () {
        location.href = '/'
      }, 600)
    }
  }

  // ============================
  // 启动
  // ============================
  document.addEventListener('DOMContentLoaded', function () {
    if ($('game-app')) {
      initGamePage()
    } else if ($('app')) {
      initHall()
    }
  })
})()
