const statusElement = document.querySelector('#status')

chrome.runtime.sendMessage({ type: 'lifeos.connectionStatus' }, (response) => {
  const state = response?.state || 'disconnected'
  statusElement.dataset.state = state
  statusElement.textContent = state === 'connected' ? '已连接' : state === 'connecting' ? '正在连接' : '未连接'
})
