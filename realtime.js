(function () {
  'use strict';

  const CONFIG_KEY = 'dlt-sync-cloud-config-v1';
  const CLIENT_ID = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  let client = null, channel = null, peer = null, peerConnection = null, peerConnections = new Map(), transport = '', roomCode = '', role = 'offline', connectionStatus = 'offline';
  const listeners = new Set();

  const el = {
    modal: document.querySelector('#roomModal'), open: document.querySelector('#roomBtn'), disconnected: document.querySelector('#roomDisconnected'), connected: document.querySelector('#roomConnected'),
    settings: document.querySelector('#cloudSettings'), configState: document.querySelector('#configState'), url: document.querySelector('#supabaseUrl'), key: document.querySelector('#supabaseKey'), save: document.querySelector('#saveCloudConfig'),
    create: document.querySelector('#createRoomBtn'), join: document.querySelector('#joinRoomBtn'), joinCode: document.querySelector('#joinRoomCode'), activeCode: document.querySelector('#activeRoomCode'),
    role: document.querySelector('#roomRoleLabel'), text: document.querySelector('#connectionText'), link: document.querySelector('#shareRoomLink'), copy: document.querySelector('#copyRoomLink'),
    peers: document.querySelector('#peerCount'), leave: document.querySelector('#leaveRoomBtn'), error: document.querySelector('#roomError')
  };

  function loadConfig() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch (_) {}
    return { ...(window.DLT_SYNC_CONFIG || {}), ...saved };
  }

  function hasConfig(config = loadConfig()) {
    return /^https:\/\//.test(config.supabaseUrl || '') && String(config.supabaseKey || '').length > 20;
  }

  function showError(message) {
    el.error.textContent = message; el.error.hidden = !message;
  }

  function updateConfigUI() {
    const config = loadConfig(), ready = hasConfig(config);
    el.url.value = config.supabaseUrl || ''; el.key.value = config.supabaseKey || '';
    el.configState.textContent = ready ? 'Supabase 已配置' : '免配置直连'; el.settings.classList.toggle('configured', ready);
  }

  function saveConfig() {
    const config = { supabaseUrl: el.url.value.trim().replace(/\/$/, ''), supabaseKey: el.key.value.trim() };
    if (/secret|service_role/i.test(config.supabaseKey)) { showError('检测到 Secret Key。为了安全，请改用 Publishable Key。'); return false; }
    if (!hasConfig(config)) { showError('请填写正确的 Project URL 和 Publishable Key。'); return false; }
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); updateConfigUI(); showError(''); return true;
  }

  function generateCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', bytes = new Uint8Array(6); crypto.getRandomValues(bytes);
    return Array.from(bytes, value => chars[value % chars.length]).join('');
  }

  function shareUrl(code) {
    const url = new URL(location.href); url.searchParams.set('room', code); return url.href;
  }

  function setConnectionUI() {
    const online = role !== 'offline';
    el.disconnected.hidden = online; el.connected.hidden = !online;
    el.open.classList.toggle('connected', online && connectionStatus === 'connected');
    el.open.querySelector('span').textContent = online ? roomCode : '联机房间';
    document.body.classList.toggle('remote-mode', role === 'remote');
    if (!online) return;
    el.activeCode.textContent = roomCode; el.role.textContent = role === 'host' ? '电脑端 · 摇奖主机' : '手机端 · 远程控制器';
    el.link.value = shareUrl(roomCode);
    el.text.textContent = connectionStatus === 'connected' ? '实时通道已连接' : connectionStatus === 'error' ? '实时通道连接失败' : '正在连接实时房间…';
  }

  function emit(type, data, sender) {
    listeners.forEach(callback => { try { callback(type, data, sender); } catch (error) { console.error(error); } });
  }

  async function connect(code, nextRole) {
    const config = loadConfig(); showError('');
    await disconnect(false);
    roomCode = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); role = nextRole; connectionStatus = 'connecting'; setConnectionUI();
    if (!hasConfig(config)) return connectPeer();
    if (!window.supabase?.createClient) { showError('Supabase 通信组件加载失败，请检查网络后刷新页面。'); return false; }
    transport = 'supabase';
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    channel = client.channel(`dlt-room:${roomCode}`, { config: { broadcast: { self: false, ack: true }, presence: { key: CLIENT_ID } } });
    channel
      .on('broadcast', { event: 'room-event' }, message => {
        const payload = message.payload || {};
        if (payload.sender !== CLIENT_ID) emit(payload.type, payload.data, payload.sender);
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel?.presenceState?.() || {}, count = Object.values(state).flat().length;
        el.peers.textContent = String(Math.max(1, count));
      })
      .subscribe(async (status, error) => {
        if (status === 'SUBSCRIBED') {
          connectionStatus = 'connected'; setConnectionUI();
          await channel.track({ clientId: CLIENT_ID, role, onlineAt: new Date().toISOString() });
          send('presence', { role });
          if (role === 'remote') send('sync-request', {});
          emit('connection', { status: 'connected', role, roomCode });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          connectionStatus = 'error'; setConnectionUI(); showError(`房间连接失败：${error?.message || status}`);
        }
      });
    return true;
  }

  function connectPeer() {
    if (!window.Peer) { showError('浏览器直连组件加载失败，请检查网络后刷新页面。'); connectionStatus = 'error'; setConnectionUI(); return false; }
    transport = 'peerjs';
    const hostPeerId = `dlt-simulator-${roomCode.toLowerCase()}`;
    peer = role === 'host' ? new window.Peer(hostPeerId) : new window.Peer();
    peer.on('open', () => {
      if (role === 'host') {
        connectionStatus = 'connected'; setConnectionUI(); el.peers.textContent = '1'; emit('connection', { status: 'connected', role, roomCode });
      } else {
        peerConnection = peer.connect(hostPeerId, { reliable: true, metadata: { role: 'remote' } }); bindPeerConnection(peerConnection);
      }
    });
    peer.on('connection', connection => { if (role === 'host') bindPeerConnection(connection); else connection.close(); });
    peer.on('error', error => {
      connectionStatus = 'error'; setConnectionUI();
      const message = error.type === 'unavailable-id' ? '这个房间码已被占用，请退出后重新创建。' : error.type === 'peer-unavailable' ? '没有找到电脑主机，请确认房间码且保持电脑页面打开。' : `浏览器直连失败：${error.type || error.message}`;
      showError(message);
    });
    return true;
  }

  function bindPeerConnection(connection) {
    connection.on('open', () => {
      if (role === 'host') peerConnections.set(connection.peer, connection); else peerConnection = connection;
      connectionStatus = 'connected'; setConnectionUI(); updatePeerCount();
      if (role === 'remote') send('sync-request', {});
      emit('connection', { status: 'connected', role, roomCode });
    });
    connection.on('data', payload => { if (payload?.sender !== CLIENT_ID) emit(payload.type, payload.data, payload.sender); });
    connection.on('close', () => {
      peerConnections.delete(connection.peer); updatePeerCount();
      if (role === 'remote') { connectionStatus = 'error'; setConnectionUI(); showError('与电脑主机的连接已断开。'); }
    });
    connection.on('error', error => showError(`设备连接错误：${error.message || error.type}`));
  }

  function updatePeerCount() {
    el.peers.textContent = String(role === 'host' ? 1 + peerConnections.size : connectionStatus === 'connected' ? 2 : 1);
  }

  function send(type, data = {}) {
    if (connectionStatus !== 'connected') return false;
    const payload = { type, data, sender: CLIENT_ID, sentAt: Date.now() };
    if (transport === 'peerjs') {
      if (role === 'host') peerConnections.forEach(connection => { if (connection.open) connection.send(payload); });
      else if (peerConnection?.open) peerConnection.send(payload);
      return true;
    }
    if (!channel) return false;
    channel.send({ type: 'broadcast', event: 'room-event', payload });
    return true;
  }

  async function disconnect(update = true) {
    if (channel) { try { await channel.untrack(); await client.removeChannel(channel); } catch (_) {} }
    peerConnections.forEach(connection => { try { connection.close(); } catch (_) {} }); peerConnections.clear();
    try { peerConnection?.close(); peer?.destroy(); } catch (_) {}
    channel = null; client = null; peer = null; peerConnection = null; transport = ''; roomCode = ''; role = 'offline'; connectionStatus = 'offline';
    if (update) { setConnectionUI(); emit('connection', { status: 'offline', role }); }
  }

  function openModal() { el.modal.hidden = false; updateConfigUI(); }
  function closeModal() { el.modal.hidden = true; showError(''); }

  el.open.addEventListener('click', openModal);
  document.querySelectorAll('[data-close-room]').forEach(button => button.addEventListener('click', closeModal));
  el.save.addEventListener('click', saveConfig);
  el.create.addEventListener('click', async () => { await connect(generateCode(), 'host'); });
  el.join.addEventListener('click', async () => {
    const code = el.joinCode.value.trim().toUpperCase(); if (code.length !== 6) { showError('请输入电脑端显示的 6 位房间码。'); return; }
    await connect(code, 'remote');
  });
  el.joinCode.addEventListener('input', () => { el.joinCode.value = el.joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
  el.copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(el.link.value); el.copy.textContent = '已复制'; setTimeout(() => el.copy.textContent = '复制链接', 1500); } catch (_) { el.link.select(); } });
  el.leave.addEventListener('click', () => disconnect());
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !el.modal.hidden) closeModal(); });

  const invitedRoom = new URL(location.href).searchParams.get('room');
  if (invitedRoom) { el.joinCode.value = invitedRoom.toUpperCase().slice(0, 6); setTimeout(openModal, 250); }
  updateConfigUI(); setConnectionUI();

  window.RoomSync = {
    connect, disconnect, send, open: openModal, onMessage(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    get role() { return role; }, get roomCode() { return roomCode; }, get connected() { return connectionStatus === 'connected'; }
  };
})();
