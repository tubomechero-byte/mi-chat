const state = {
  socket: null,
  currentUser: null,
  activeChat: { type: 'channel', id: 'general' },
  soundEnabled: true,
  typingTimeout: null,
  users: []
};

const elements = {
  loginModal: document.getElementById('login-modal'),
  loginForm: document.getElementById('login-form'),
  usernameInput: document.getElementById('username-input'),
  appContainer: document.getElementById('app-container'),
  
  myAvatar: document.getElementById('my-avatar'),
  myUsername: document.getElementById('my-username'),
  onlineCount: document.getElementById('online-count'),
  usersList: document.getElementById('users-list'),
  channelsList: document.querySelectorAll('.channel-item'),
  
  chatTitle: document.getElementById('current-chat-title'),
  chatSubtitle: document.getElementById('current-chat-subtitle'),
  messagesContainer: document.getElementById('messages-container'),
  
  messageForm: document.getElementById('message-form'),
  messageInput: document.getElementById('message-input'),
  typingIndicator: document.getElementById('typing-indicator'),
  typingText: document.getElementById('typing-text'),
  
  soundToggle: document.getElementById('sound-toggle'),
  emojiBtn: document.getElementById('emoji-btn'),
  emojiPicker: document.getElementById('emoji-picker')
};

function playSound(type) {
  if (!state.soundEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    if (type === 'sent') {
      osc.frequency.setValueAtTime(600, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.1);
    } else if (type === 'received') {
      osc.frequency.setValueAtTime(400, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    }
  } catch (e) {
    console.warn('Audio Web API error:', e);
  }
}

function connectSocket(username) {
  state.socket = io();

  state.socket.emit('register_user', username);

  state.socket.on('init_data', (data) => {
    state.currentUser = data.currentUser;
    elements.myUsername.textContent = data.currentUser.username;
    elements.myAvatar.textContent = data.currentUser.username[0].toUpperCase();
    elements.myAvatar.style.backgroundColor = data.currentUser.avatarColor;

    renderUsers(data.usersList);
    renderHistory(data.history);

    elements.loginModal.classList.add('hidden');
    elements.appContainer.classList.remove('hidden');
  });

  state.socket.on('users_update', (users) => {
    state.users = users;
    renderUsers(users);
  });

  state.socket.on('new_message', (msg) => {
    if (state.activeChat.type === 'channel' && state.activeChat.id === msg.room) {
      appendMessage(msg);
      if (msg.senderId !== state.socket.id) playSound('received');
    }
  });

  state.socket.on('new_private_message', (msg) => {
    const partnerId = msg.senderId === state.socket.id ? msg.recipientId : msg.senderId;
    if (state.activeChat.type === 'private' && state.activeChat.id === partnerId) {
      appendMessage(msg);
    }
    if (msg.senderId !== state.socket.id) {
      playSound('received');
    }
  });

  state.socket.on('user_joined', (data) => appendSystemMessage(data.message));
  state.socket.on('user_left', (data) => appendSystemMessage(data.message));

  state.socket.on('room_changed', (data) => {
    renderHistory(data.history);
  });

  state.socket.on('user_typing', (data) => {
    if (data.isTyping) {
      elements.typingText.textContent = `${data.username} está escribiendo...`;
      elements.typingIndicator.classList.remove('hidden');
    } else {
      elements.typingIndicator.classList.add('hidden');
    }
  });
}

function renderUsers(users) {
  const otherUsers = users.filter(u => u.id !== state.socket?.id);
  elements.onlineCount.textContent = otherUsers.length;

  elements.usersList.innerHTML = '';
  if (otherUsers.length === 0) {
    elements.usersList.innerHTML = '<li style="color:var(--text-muted); font-size:0.85rem; padding:0.5rem;">No hay otros usuarios</li>';
    return;
  }

  otherUsers.forEach(user => {
    const li = document.createElement('li');
    li.className = `user-item ${state.activeChat.type === 'private' && state.activeChat.id === user.id ? 'active' : ''}`;
    li.dataset.userId = user.id;
    li.innerHTML = `
      <div class="avatar sm" style="background-color: ${user.avatarColor}">${user.username[0].toUpperCase()}</div>
      <span class="user-name">${user.username}</span>
    `;
    
    li.addEventListener('click', () => switchPrivateChat(user));
    elements.usersList.appendChild(li);
  });
}

function switchPrivateChat(user) {
  state.activeChat = { type: 'private', id: user.id, username: user.username };
  
  document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
  renderUsers(state.users);

  elements.chatTitle.innerHTML = `<i class="fa-solid fa-lock"></i> Chat con ${user.username}`;
  elements.chatSubtitle.textContent = 'Mensaje privado confidencial';
  elements.messageInput.placeholder = `Enviar mensaje privado a @${user.username}...`;
  elements.messagesContainer.innerHTML = '';
  appendSystemMessage(`Iniciaste un chat privado con ${user.username}.`);
}

function switchChannel(channelName) {
  state.activeChat = { type: 'channel', id: channelName };

  document.querySelectorAll('.channel-item').forEach(el => {
    el.classList.toggle('active', el.dataset.room === channelName);
  });
  renderUsers(state.users);

  elements.chatTitle.innerHTML = `<i class="fa-solid fa-hashtag"></i> ${channelName}`;
  elements.chatSubtitle.textContent = `Canal público #${channelName}`;
  elements.messageInput.placeholder = `Escribe un mensaje en #${channelName}...`;

  state.socket.emit('join_room', channelName);
}

function renderHistory(history) {
  elements.messagesContainer.innerHTML = '';
  if (history && history.length > 0) {
    history.forEach(msg => appendMessage(msg));
  } else {
    appendSystemMessage('No hay mensajes previos en este canal. ¡Sé el primero en saludar!');
  }
}

function appendMessage(msg) {
  const isMine = msg.senderId === state.socket.id;
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${isMine ? 'mine' : ''}`;

  wrapper.innerHTML = `
    <div class="avatar sm" style="background-color: ${msg.avatarColor}">${msg.senderName[0].toUpperCase()}</div>
    <div class="message-content">
      <div class="message-header">
        <span class="message-sender">${msg.senderName}</span>
        ${msg.isPrivate ? '<span class="badge-private">PRIVADO</span>' : ''}
        <span class="message-time">${msg.timestamp}</span>
      </div>
      <div class="message-bubble">${escapeHtml(msg.text)}</div>
    </div>
  `;

  elements.messagesContainer.appendChild(wrapper);
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

function appendSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.textContent = text;
  elements.messagesContainer.appendChild(div);
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

elements.loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = elements.usernameInput.value.trim();
  if (username) {
    connectSocket(username);
  }
});

elements.channelsList.forEach(item => {
  item.addEventListener('click', () => switchChannel(item.dataset.room));
});

elements.messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = elements.messageInput.value.trim();
  if (!text) return;

  if (state.activeChat.type === 'channel') {
    state.socket.emit('send_message', { text });
  } else if (state.activeChat.type === 'private') {
    state.socket.emit('send_private_message', {
      recipientId: state.activeChat.id,
      text
    });
  }

  playSound('sent');
  elements.messageInput.value = '';
  state.socket.emit('typing', false);
});

elements.messageInput.addEventListener('input', () => {
  state.socket.emit('typing', true);
  clearTimeout(state.typingTimeout);
  state.typingTimeout = setTimeout(() => {
    state.socket.emit('typing', false);
  }, 1500);
});

elements.soundToggle.addEventListener('click', () => {
  state.soundEnabled = !state.soundEnabled;
  elements.soundToggle.innerHTML = state.soundEnabled 
    ? '<i class="fa-solid fa-volume-high"></i>' 
    : '<i class="fa-solid fa-volume-xmark" style="color:#ef4444"></i>';
});

elements.emojiBtn.addEventListener('click', () => {
  elements.emojiPicker.classList.toggle('hidden');
});

elements.emojiPicker.querySelectorAll('span').forEach(emojiSpan => {
  emojiSpan.addEventListener('click', () => {
    elements.messageInput.value += emojiSpan.textContent;
    elements.emojiPicker.classList.add('hidden');
    elements.messageInput.focus();
  });
});
