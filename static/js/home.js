
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
  content = `${data.text}<div class="message-time">${data.time || ''}${data.user === username ? '' : ' · ' + data.user}</div>`
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
  ws.send(JSON.stringify({ type: 'login', user: username }))
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
    ws.send(JSON.stringify({ type: 'logout' }))
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
    ws.send(JSON.stringify({ type: 'msg', text: $msg.value }))
    $msg.value = ''
  }
})
function openn(msg){
  if (msg === 'h'){
    window.open("https://space.bilibili.com/1519941537", '_blank')
  }else if (msg === 'n'){
    window.open("https://space.bilibili.com/2140306819", '_blank')
  }
}
function run(){
  window.open("https://hzl-chatroom.deno.dev/static/", '_blank')
}