/* ============================================================
 * 后台管理页脚本
 * 门禁由服务端 cookie 保证：缺少 admin_entry 令牌的 /admin 访问会被拒绝。
 * 本页只负责轮询 /admin/api/state 并触发管理操作。
 * ============================================================ */
(function () {
  'use strict'

  const $ = function (id) {
    return document.getElementById(id)
  }
  const userListEl = $('user-list')
  const onlineCountEl = $('online-count')
  const roomStatusEl = $('room-status')
  const resetBtn = $('reset-room-btn')
  const backHome = $('back-home')

  if (backHome) {
    backHome.addEventListener('click', function () {
      window.location.href = '/'
    })
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    })
  }

  function stateLabel(s) {
    if (s === 'drawing') return '进行中'
    if (s === 'roundOver') return '本轮结束'
    return '等待中'
  }

  async function loadState() {
    try {
      const r = await fetch('/admin/api/state', { credentials: 'same-origin' })
      if (r.status === 403) {
        document.body.innerHTML =
          '<div style="text-align:center;padding:60px;font-family:sans-serif">' +
          '<h1>🚫 会话已失效</h1><p>请重新从首页点击隐藏入口进入后台。</p>' +
          '<p><a href="/">返回首页</a></p></div>'
        clearInterval(timer)
        return
      }
      const data = await r.json()
      render(data)
    } catch (e) {
      /* 网络抖动忽略，下一轮轮询重试 */
    }
  }

  function render(data) {
    const room = data.room
    onlineCountEl.textContent = room ? room.playerCount : 0

    // 房间状态
    roomStatusEl.innerHTML = ''
    if (room) {
      const items = [
        ['房间 ID', room.id],
        ['状态', stateLabel(room.state)],
        ['当前画手', room.currentDrawer || '—'],
        ['在线人数', room.playerCount],
        ['是否已出题', room.answerSet ? '是' : '否'],
      ]
      items.forEach(function (it) {
        const row = document.createElement('div')
        row.className = 'status-row'
        row.innerHTML = '<span class="k">' + esc(it[0]) + '</span><span class="v">' + esc(it[1]) + '</span>'
        roomStatusEl.appendChild(row)
      })
    }

    // 在线用户列表
    userListEl.innerHTML = ''
    if (!data.players.length) {
      const li = document.createElement('li')
      li.className = 'empty'
      li.textContent = '暂无在线用户'
      userListEl.appendChild(li)
    } else {
      data.players.forEach(function (p) {
        const li = document.createElement('li')
        li.className = 'user-row'

        const name = document.createElement('span')
        name.className = 'u-name'
        name.textContent = p.user
        li.appendChild(name)

        if (p.isDrawer) {
          const badge = document.createElement('span')
          badge.className = 'badge drawer'
          badge.textContent = '当前画手'
          li.appendChild(badge)
        }

        const score = document.createElement('span')
        score.className = 'u-score'
        score.textContent = p.score + ' 分'
        li.appendChild(score)

        const del = document.createElement('button')
        del.className = 'danger del-btn'
        del.type = 'button'
        del.textContent = '删除用户'
        del.addEventListener('click', function () {
          deleteUser(p.user)
        })
        li.appendChild(del)

        userListEl.appendChild(li)
      })
    }
  }

  async function deleteUser(name) {
    if (!confirm('确定删除用户「' + name + '」并踢出其连接？')) return
    try {
      const r = await fetch('/admin/api/users/' + encodeURIComponent(name) + '/delete', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const j = await r.json().catch(function () {
        return {}
      })
      if (r.ok) {
        loadState()
      } else {
        alert('删除失败：' + (j.error || r.status))
      }
    } catch (e) {
      alert('删除失败：网络错误')
    }
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', async function () {
      if (!confirm('确定强制重启房间？这将踢出所有用户并清空全部房间状态！')) return
      try {
        const r = await fetch('/admin/api/room/reset', { method: 'POST', credentials: 'same-origin' })
        const j = await r.json().catch(function () {
          return {}
        })
        if (r.ok) {
          alert('房间已强制重启')
          loadState()
        } else {
          alert('重启失败：' + (j.error || r.status))
        }
      } catch (e) {
        alert('重启失败：网络错误')
      }
    })
  }

  loadState()
  const timer = setInterval(loadState, 3000)
})()
