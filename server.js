const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Render asigna dinámicamente la variable PORT
const PORT = process.env.PORT || 3000;

// Archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Almacenamiento en memoria
const users = {};
const roomHistory = {
  general: [],
  tecnologia: [],
  proyectos: [],
  random: []
};

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#14b8a6'
];

function getRandomColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

io.on('connection', (socket) => {
  console.log(`[+] Conexión establecida: ${socket.id}`);

  socket.on('register_user', (username) => {
    const cleanUsername = username ? username.trim() : `Usuario_${socket.id.substring(0, 4)}`;
    
    users[socket.id] = {
      id: socket.id,
      username: cleanUsername,
      room: 'general',
      avatarColor: getRandomColor()
    };

    socket.join('general');

    socket.emit('init_data', {
      currentUser: users[socket.id],
      usersList: Object.values(users),
      history: roomHistory['general'] || []
    });

    socket.to('general').emit('user_joined', {
      user: users[socket.id],
      message: `${users[socket.id].username} se ha unido al chat.`
    });

    io.emit('users_update', Object.values(users));
  });

  socket.on('join_room', (newRoom) => {
    const user = users[socket.id];
    if (!user) return;

    const oldRoom = user.room;

    socket.leave(oldRoom);
    socket.to(oldRoom).emit('user_left', {
      user,
      message: `${user.username} ha salido del canal.`
    });

    user.room = newRoom;
    socket.join(newRoom);

    if (!roomHistory[newRoom]) {
      roomHistory[newRoom] = [];
    }

    socket.emit('room_changed', {
      room: newRoom,
      history: roomHistory[newRoom]
    });

    socket.to(newRoom).emit('user_joined', {
      user,
      message: `${user.username} se ha unido a #${newRoom}.`
    });

    io.emit('users_update', Object.values(users));
  });

  socket.on('send_message', (data) => {
    const user = users[socket.id];
    if (!user) return;

    const msgData = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
      senderId: socket.id,
      senderName: user.username,
      avatarColor: user.avatarColor,
      text: data.text,
      room: user.room,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    if (!roomHistory[user.room]) roomHistory[user.room] = [];
    roomHistory[user.room].push(msgData);
    if (roomHistory[user.room].length > 50) roomHistory[user.room].shift();

    io.to(user.room).emit('new_message', msgData);
  });

  socket.on('send_private_message', (data) => {
    const sender = users[socket.id];
    const targetSocket = io.sockets.sockets.get(data.recipientId);

    if (!sender || !targetSocket) {
      socket.emit('private_error', { message: 'El usuario ya no está disponible.' });
      return;
    }

    const msgData = {
      id: Date.now().toString(),
      senderId: socket.id,
      senderName: sender.username,
      avatarColor: sender.avatarColor,
      recipientId: data.recipientId,
      text: data.text,
      isPrivate: true,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    targetSocket.emit('new_private_message', msgData);
    socket.emit('new_private_message', msgData);
  });

  socket.on('typing', (isTyping) => {
    const user = users[socket.id];
    if (!user) return;

    socket.to(user.room).emit('user_typing', {
      userId: socket.id,
      username: user.username,
      isTyping
    });
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      console.log(`[-] Desconectado: ${user.username}`);
      io.emit('user_left', {
        user,
        message: `${user.username} se ha desconectado.`
      });
      delete users[socket.id];
      io.emit('users_update', Object.values(users));
    }
  });
});

// Importante: Escuchar en '0.0.0.0' para ser compatible con el entorno de Render
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor listo y escuchando en el puerto ${PORT}`);
});
