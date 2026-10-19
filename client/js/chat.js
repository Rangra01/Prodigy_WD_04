/* ==========================================================================
   chat.js — chat dashboard: session restore, Socket.IO, rendering.
   All user-generated text is rendered with textContent (never innerHTML).
   ========================================================================== */

(function () {
  'use strict';

  const SELECTION_KEY = 'chat_selection';
  const MAX_MESSAGE_LENGTH = 2000;

  // ---- State -------------------------------------------------------------
  let currentUser = null;
  let socket = null;
  let rooms = [];
  let users = [];
  let active = null; // { type: 'room' | 'private', id, name }
  let seenIds = new Set(); // message ids already rendered (duplicate guard)
  let atBottom = true;
  let redirectedToLogin = false;
  let errorTimer = null;

  const el = {};

  function cacheElements() {
    [
      'meAvatar', 'meUsername', 'logoutBtn',
      'createRoomBtn', 'createRoomForm', 'roomNameInput', 'createRoomSubmit',
      'cancelRoomBtn', 'createRoomError', 'roomList', 'userList',
      'connDot', 'connText', 'sidebar', 'sidebarOverlay', 'menuBtn',
      'activeTitle', 'activeSubtitle', 'activeBadge', 'noticeBar',
      'messages', 'emptyState', 'emptyText', 'jumpBtn', 'errorBar',
      'messageForm', 'messageInput', 'sendBtn',
    ].forEach((id) => {
      el[id] = document.getElementById(id);
    });
  }

  // ---- Boot --------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheElements();

    // No token → straight to the login page.
    if (!getToken()) {
      window.location.replace('/login.html');
      return;
    }

    bindUI();
    showNotice('Restoring your session…');

    let user = null;
    try {
      const result = await apiRequest('/api/auth/me');
      if (!result.ok) {
        redirectToLogin(result.status);
        return;
      }
      user = result.data && result.data.user;
    } catch (err) {
      hideNotice();
      showError('Cannot reach the server. Make sure it is running, then refresh this page.');
      return;
    }

    if (!user) {
      redirectToLogin(401);
      return;
    }

    currentUser = user;
    el.meUsername.textContent = user.username;
    el.meAvatar.textContent = user.username.charAt(0).toUpperCase();
    hideNotice();

    await Promise.all([loadRooms(), loadUsers()]);
    connectSocket();
    restoreSelection();
  }

  function redirectToLogin(status) {
    if (redirectedToLogin) return;
    redirectedToLogin = true;
    clearToken();
    try {
      sessionStorage.removeItem(SELECTION_KEY);
    } catch (err) {
      /* ignore */
    }
    // A failed /api/auth/me (401) or a rejected socket token both land here.
    window.location.replace('/login.html?expired=1');
  }

  // ---- UI wiring (registered exactly once) --------------------------------
  function bindUI() {
    el.logoutBtn.addEventListener('click', logout);

    el.createRoomBtn.addEventListener('click', () => {
      const showing = !el.createRoomForm.hidden;
      el.createRoomForm.hidden = showing;
      if (!showing) {
        hideBanner(el.createRoomError);
        el.roomNameInput.focus();
      }
    });
    el.cancelRoomBtn.addEventListener('click', () => {
      el.createRoomForm.hidden = true;
      hideBanner(el.createRoomError);
    });
    el.createRoomForm.addEventListener('submit', createRoom);

    el.messageForm.addEventListener('submit', (event) => {
      event.preventDefault();
      sendCurrentMessage();
    });
    el.messageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendCurrentMessage();
      }
    });
    el.messageInput.addEventListener('input', autoGrow);

    el.messages.addEventListener('scroll', () => {
      const distance =
        el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight;
      atBottom = distance < 60;
      if (atBottom) el.jumpBtn.hidden = true;
    });
    el.jumpBtn.addEventListener('click', scrollToBottom);

    el.menuBtn.addEventListener('click', () => setSidebarOpen(true));
    el.sidebarOverlay.addEventListener('click', () => setSidebarOpen(false));
  }

  function setSidebarOpen(open) {
    el.sidebar.classList.toggle('open', open);
    el.sidebarOverlay.hidden = !open;
  }

  function closeSidebarOnMobile() {
    if (el.sidebar.classList.contains('open')) setSidebarOpen(false);
  }

  // ---- Data loading -------------------------------------------------------
  async function loadRooms() {
    try {
      const result = await apiRequest('/api/rooms');
      if (!result.ok) {
        handleDataError(result);
        return;
      }
      rooms = (result.data && result.data.rooms) || [];
      renderRooms();
      updateHeader();
    } catch (err) {
      showError('Could not load rooms.');
    }
  }

  async function loadUsers() {
    try {
      const result = await apiRequest('/api/users');
      if (!result.ok) {
        handleDataError(result);
        return;
      }
      users = (result.data && result.data.users) || [];
      renderUsers();
      updateHeader();
    } catch (err) {
      showError('Could not load users.');
    }
  }

  function handleDataError(result) {
    if (result.status === 401) {
      redirectToLogin(401);
      return;
    }
    showError((result.data && result.data.message) || 'Failed to load data.');
  }

  // ---- Sidebar rendering (textContent only — no HTML strings) --------------
  function renderRooms() {
    el.roomList.textContent = '';

    if (!rooms.length) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = 'No rooms yet — create one with "+ New".';
      el.roomList.appendChild(li);
      return;
    }

    rooms.forEach((room) => {
      const isActive = active && active.type === 'room' && String(active.id) === String(room._id);

      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list-item' + (isActive ? ' active' : '');
      if (isActive) btn.setAttribute('aria-current', 'true');

      const name = document.createElement('span');
      name.className = 'item-name';
      name.textContent = room.name;

      const meta = document.createElement('span');
      meta.className = 'item-meta';
      meta.textContent = `${room.memberCount} ${room.memberCount === 1 ? 'member' : 'members'}`;

      btn.appendChild(name);
      btn.appendChild(meta);
      btn.addEventListener('click', () => selectRoom(room._id, room.name));

      li.appendChild(btn);
      el.roomList.appendChild(li);
    });
  }

  function renderUsers() {
    el.userList.textContent = '';

    if (!users.length) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = 'No other users registered yet.';
      el.userList.appendChild(li);
      return;
    }

    users.forEach((user) => {
      const isActive = active && active.type === 'private' && String(active.id) === String(user._id);

      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list-item' + (isActive ? ' active' : '');
      if (isActive) btn.setAttribute('aria-current', 'true');

      const dot = document.createElement('span');
      dot.className = 'dot ' + (user.isOnline ? 'dot-online' : 'dot-offline');

      const name = document.createElement('span');
      name.className = 'item-name';
      name.textContent = user.username;

      const meta = document.createElement('span');
      meta.className = 'item-meta';
      meta.textContent = user.isOnline ? 'Online' : 'Offline';

      btn.appendChild(dot);
      btn.appendChild(name);
      btn.appendChild(meta);
      btn.addEventListener('click', () => selectUser(user._id, user.username));

      li.appendChild(btn);
      el.userList.appendChild(li);
    });
  }

  // ---- Header (shows current user's selection) -----------------------------
  function updateHeader() {
    if (!active) {
      el.activeTitle.textContent = 'Select a conversation';
      el.activeSubtitle.textContent = 'Pick a room or a user from the sidebar to start chatting.';
      el.activeBadge.hidden = true;
      document.title = 'Chat — Real-Time Chat';
      return;
    }

    if (active.type === 'room') {
      const room = rooms.find((r) => String(r._id) === active.id);
      const count = room ? room.memberCount : 0;
      el.activeTitle.textContent = '#' + active.name;
      el.activeSubtitle.textContent = `${count} ${count === 1 ? 'member' : 'members'} · chat room`;
      el.activeBadge.textContent = 'Room';
      el.activeBadge.hidden = false;
      document.title = '#' + active.name + ' — Real-Time Chat';
    } else {
      const user = users.find((u) => String(u._id) === active.id);
      el.activeTitle.textContent = active.name;
      el.activeSubtitle.textContent =
        (user && user.isOnline ? 'Online' : 'Offline') + ' · private conversation';
      el.activeBadge.textContent = 'Private';
      el.activeBadge.hidden = false;
      document.title = '@' + active.name + ' — Real-Time Chat';
    }
  }

  // ---- Socket.IO (created once; listeners survive reconnects) --------------
  function connectSocket() {
    socket = io({ auth: { token: getToken() } });

    socket.on('connect', () => {
      setConnectionState(true);
      // Rejoin + reload after every (re)connect. No duplicate listeners.
      ensureActiveJoined();
    });

    socket.on('disconnect', () => {
      setConnectionState(false);
    });

    socket.on('connect_error', (err) => {
      const message = String((err && err.message) || '');
      if (/token|authenticat|log in again/i.test(message)) {
        redirectToLogin(401);
        return;
      }
      setConnectionState(false);
    });

    socket.on('receiveMessage', handleIncomingMessage);
    socket.on('receivePrivateMessage', handleIncomingMessage);
    socket.on('userStatus', handleUserStatus);
    socket.on('chatError', (data) => {
      showError((data && data.message) || 'Something went wrong.');
    });
  }

  function setConnectionState(connected) {
    if (connected) {
      el.connDot.className = 'dot dot-online';
      el.connText.textContent = 'Connected';
    } else {
      el.connDot.className = 'dot dot-offline';
      el.connText.textContent = 'Disconnected — reconnecting…';
    }
    updateComposerState();
  }

  function updateComposerState() {
    const enabled = !!active && !!socket && socket.connected;
    el.messageInput.disabled = !enabled;
    el.sendBtn.disabled = !enabled;

    if (enabled) {
      el.messageInput.placeholder =
        active.type === 'room' ? `Message #${active.name}` : `Message @${active.name}`;
    } else if (active) {
      el.messageInput.placeholder = 'Waiting for the connection…';
    } else {
      el.messageInput.placeholder = 'Select a conversation to start typing';
    }
  }

  // ---- Conversation selection ----------------------------------------------
  function selectRoom(roomId, name) {
    setActive({ type: 'room', id: String(roomId), name });
    ensureActiveJoined();
  }

  function selectUser(userId, username) {
    setActive({ type: 'private', id: String(userId), name: username });
    ensureActiveJoined();
  }

  function setActive(selection) {
    active = selection;
    saveSelection();
    renderRooms();
    renderUsers();
    updateHeader();
    clearMessages();
    if (active) {
      el.emptyState.hidden = false;
      el.emptyText.textContent = 'Loading messages…';
    }
    updateComposerState();
    hideError();
    closeSidebarOnMobile();
  }

  function isStillActive(id) {
    return !!active && String(active.id) === String(id);
  }

  /**
   * Join the active conversation and load its history.
   * Called on selection AND on every socket (re)connect so a refresh or a
   * dropped connection always restores the current conversation.
   */
  function ensureActiveJoined() {
    if (!active || !socket || !socket.connected) return;

    if (active.type === 'room') {
      const roomId = active.id;
      apiRequest(`/api/rooms/${roomId}/join`, { method: 'POST' })
        .then((joinResult) => {
          if (!joinResult.ok) {
            handleDataError(joinResult);
            return;
          }
          if (!isStillActive(roomId) || !socket.connected) return;
          socket.emit('joinRoom', { roomId }, (res) => {
            if (!res || !res.ok) {
              showError((res && res.message) || 'Could not join the room.');
              return;
            }
            if (!isStillActive(roomId)) return;
            loadRoomMessages(roomId);
          });
        })
        .catch(() => showError('Could not join the room. Check your connection.'));
    } else {
      const userId = active.id;
      socket.emit('joinPrivateConversation', { recipientId: userId }, (res) => {
        if (!res || !res.ok) {
          showError((res && res.message) || 'Could not open the conversation.');
          return;
        }
        if (!isStillActive(userId)) return;
        loadPrivateMessages(userId);
      });
    }
  }

  function restoreSelection() {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(SELECTION_KEY));
    } catch (err) {
      saved = null;
    }
    if (!saved || !saved.type || !saved.id) return;

    if (saved.type === 'room') {
      const room = rooms.find((r) => String(r._id) === String(saved.id));
      if (room) selectRoom(room._id, room.name);
    } else if (saved.type === 'private') {
      const user = users.find((u) => String(u._id) === String(saved.id));
      if (user) selectUser(user._id, user.username);
    }
  }

  function saveSelection() {
    try {
      if (active) sessionStorage.setItem(SELECTION_KEY, JSON.stringify(active));
      else sessionStorage.removeItem(SELECTION_KEY);
    } catch (err) {
      /* ignore */
    }
  }

  // ---- Message history ------------------------------------------------------
  async function loadRoomMessages(roomId) {
    try {
      const result = await apiRequest(`/api/rooms/${roomId}/messages`);
      if (!isStillActive(roomId)) return;
      if (!result.ok) {
        handleDataError(result);
        return;
      }
      renderHistory((result.data && result.data.messages) || []);
    } catch (err) {
      if (isStillActive(roomId)) showError('Could not load messages.');
    }
  }

  async function loadPrivateMessages(userId) {
    try {
      const result = await apiRequest(`/api/messages/private/${userId}`);
      if (!isStillActive(userId)) return;
      if (!result.ok) {
        handleDataError(result);
        return;
      }
      renderHistory((result.data && result.data.messages) || []);
    } catch (err) {
      if (isStillActive(userId)) showError('Could not load messages.');
    }
  }

  function clearMessages() {
    el.messages.textContent = '';
    seenIds = new Set();
    atBottom = true;
    el.jumpBtn.hidden = true;
  }

  function renderHistory(messages) {
    el.messages.textContent = '';
    seenIds = new Set();

    const fragment = document.createDocumentFragment();
    messages.forEach((msg) => {
      seenIds.add(String(msg._id));
      fragment.appendChild(buildMessageNode(msg));
    });
    el.messages.appendChild(fragment);

    const isEmpty = messages.length === 0;
    el.emptyState.hidden = !isEmpty;
    if (isEmpty) {
      el.emptyText.textContent =
        active && active.type === 'private'
          ? `No messages yet with ${active.name} — say hello!`
          : 'No messages yet — say hello!';
    }

    scrollToBottom();
  }

  // Safe rendering: every piece of user content goes through textContent.
  function buildMessageNode(msg) {
    const senderId = msg.sender ? String(msg.sender._id || msg.sender) : '';
    const mine = !!currentUser && senderId === String(currentUser._id);

    const li = document.createElement('li');
    li.className = 'msg' + (mine ? ' msg-mine' : '');

    const meta = document.createElement('div');
    meta.className = 'msg-meta';

    const author = document.createElement('span');
    author.className = 'msg-author';
    author.textContent = mine
      ? 'You'
      : (msg.sender && msg.sender.username ? msg.sender.username : 'Unknown');

    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = formatTime(msg.createdAt);

    meta.appendChild(author);
    meta.appendChild(time);

    const body = document.createElement('p');
    body.className = 'msg-body';
    body.textContent = typeof msg.content === 'string' ? msg.content : '';

    li.appendChild(meta);
    li.appendChild(body);
    return li;
  }

  function formatTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const sameDay = date.toDateString() === new Date().toDateString();
    if (sameDay) return time;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
  }

  // ---- Live messages --------------------------------------------------------
  function conversationIdFor(userA, userB) {
    // Same deterministic algorithm as the server (sorted ids joined by "_").
    return [String(userA), String(userB)].sort().join('_');
  }

  function handleIncomingMessage(msg) {
    if (!msg || !msg._id || !active || !currentUser) return;

    const messageId = String(msg._id);
    if (seenIds.has(messageId)) return; // ignore duplicate delivery

    if (msg.roomId) {
      if (active.type !== 'room' || String(msg.roomId) !== active.id) return;
    } else if (msg.conversationId) {
      if (active.type !== 'private') return;
      if (msg.conversationId !== conversationIdFor(currentUser._id, active.id)) return;
    } else {
      return;
    }

    seenIds.add(messageId);
    const wasEmpty = el.messages.childNodes.length === 0;
    el.messages.appendChild(buildMessageNode(msg));
    if (wasEmpty) el.emptyState.hidden = true;

    if (atBottom) scrollToBottom();
    else el.jumpBtn.hidden = false;
  }

  function scrollToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
    atBottom = true;
    el.jumpBtn.hidden = true;
  }

  // ---- Presence -------------------------------------------------------------
  let usersRefreshing = false;

  function handleUserStatus(status) {
    if (!status || !status.userId || !currentUser) return;
    const id = String(status.userId);
    if (id === String(currentUser._id)) return; // never in our own list

    const user = users.find((u) => String(u._id) === id);
    if (!user) {
      // Someone we have not seen yet (e.g. registered after we loaded the
      // list) — refresh once so they show up in the Users panel.
      if (!usersRefreshing) {
        usersRefreshing = true;
        loadUsers().finally(() => {
          usersRefreshing = false;
        });
      }
      return;
    }

    const online = status.status === 'online';
    if (user.isOnline === online) return;
    user.isOnline = online;
    renderUsers();
    updateHeader();
  }

  // ---- Sending --------------------------------------------------------------
  function sendCurrentMessage() {
    if (!active) return;
    if (!socket || !socket.connected) {
      showError('Not connected yet — the message will be possible once reconnected.');
      return;
    }

    const text = el.messageInput.value.trim();
    if (!text) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      showError(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`);
      return;
    }

    // The message itself arrives back via receiveMessage/receivePrivateMessage
    // (single delivery path → no duplicates). The ack only confirms the send.
    const onAck = (res) => {
      if (!res || !res.ok) {
        showError((res && res.message) || 'Message could not be sent.');
        return;
      }
      el.messageInput.value = '';
      autoGrow();
      el.messageInput.focus();
    };

    if (active.type === 'room') {
      socket.emit('sendMessage', { roomId: active.id, content: text }, onAck);
    } else {
      socket.emit('sendPrivateMessage', { recipientId: active.id, content: text }, onAck);
    }
  }

  function autoGrow() {
    el.messageInput.style.height = 'auto';
    el.messageInput.style.height = Math.min(el.messageInput.scrollHeight, 132) + 'px';
  }

  // ---- Create room ----------------------------------------------------------
  async function createRoom(event) {
    event.preventDefault();
    hideBanner(el.createRoomError);

    const name = el.roomNameInput.value.trim();
    if (name.length < 2 || name.length > 40) {
      showBanner(el.createRoomError, 'Room name must be 2–40 characters.');
      return;
    }

    setLoading(el.createRoomSubmit, true, 'Creating…');
    try {
      const result = await apiRequest('/api/rooms', { method: 'POST', body: { name } });
      if (!result.ok) {
        if (result.status === 401) {
          redirectToLogin(401);
          return;
        }
        showBanner(
          el.createRoomError,
          (result.data && result.data.message) || 'Could not create the room.'
        );
        return;
      }

      el.roomNameInput.value = '';
      el.createRoomForm.hidden = true;
      await loadRooms();
      selectRoom(result.data.room._id, result.data.room.name);
    } catch (err) {
      showBanner(el.createRoomError, 'Could not reach the server.');
    } finally {
      setLoading(el.createRoomSubmit, false);
    }
  }

  // ---- Logout ---------------------------------------------------------------
  function logout() {
    try {
      sessionStorage.removeItem(SELECTION_KEY);
    } catch (err) {
      /* ignore */
    }
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    clearToken();
    window.location.href = '/login.html?loggedout=1';
  }

  // ---- Notices & errors -----------------------------------------------------
  function showError(message) {
    el.errorBar.textContent = message;
    el.errorBar.hidden = false;
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => {
      el.errorBar.hidden = true;
    }, 5000);
  }

  function hideError() {
    if (errorTimer) clearTimeout(errorTimer);
    el.errorBar.hidden = true;
  }

  function showNotice(message) {
    el.noticeBar.textContent = message;
    el.noticeBar.hidden = false;
  }

  function hideNotice() {
    el.noticeBar.hidden = true;
  }
})();
