const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

// ----- Data -----
const activeUsers = new Map();      // socketId -> user
const usedNames = new Set();
const chatHistory = [];
const MAX_HISTORY = 200;

const FIXED_ROOM = "CODEXZENDRXGREAT";
const ADMIN_CODE = "zendrxmani";
const MAX_ADMINS = 4;
let currentAdminCount = 0;

const COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7B731'];

// Name validation: only letters, numbers, spaces, and minimum 2 chars, max 20
function isValidName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 20) return false;
  // Allow letters (including unicode letters? but we'll restrict to basic for safety), numbers, spaces
  // Disallow emoji, special chars
  const allowedRegex = /^[a-zA-Z0-9 ]+$/;
  return allowedRegex.test(trimmed);
}

function generateRandomName() {
  const adj = ['Quiet','Loud','Happy','Sleepy','Clever','Bold','Calm','Wise','Swift','Brave','Silly','Smart','Wild','Tiny','Giant','Magic','Cosmic','Electric','Mystic','Rapid'];
  const nouns = ['Panda','Tiger','Eagle','Wolf','Fox','Owl','Hawk','Deer','Bear','Lion','Koala','Sloth','Falcon','Raven','Cobra','Lynx','Viper','Horse','Dragon','Phoenix'];
  let name;
  do { name = adj[Math.floor(Math.random()*adj.length)] + nouns[Math.floor(Math.random()*nouns.length)]; } while (usedNames.has(name));
  usedNames.add(name);
  return name;
}

function getRoomUsers() {
  const users = [];
  for (const [id, user] of activeUsers.entries()) {
    if (user.room === FIXED_ROOM) {
      users.push({ id, name: user.name, color: user.color, isAdmin: user.isAdmin, isMuted: user.isMuted });
    }
  }
  return users;
}

function broadcastUserList() {
  io.to(FIXED_ROOM).emit('user-list', getRoomUsers());
}

function addToHistory(msg) {
  chatHistory.push(msg);
  if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
}

// View-once cleanup
function tryDeleteViewOnceImage(message) {
  if (!message.viewOnce) return;
  const currentUserIds = new Set(Array.from(activeUsers.keys()));
  const viewers = message.viewedBy || new Set();
  let allViewed = true;
  for (let uid of currentUserIds) {
    if (!viewers.has(uid)) { allViewed = false; break; }
  }
  if (allViewed && message.imageData) {
    message.imageData = null;
    io.to(FIXED_ROOM).emit('image-expired', { messageId: message.id });
    console.log(`View-once image ${message.id} deleted (all ${currentUserIds.size} users saw it)`);
  }
}

io.on('connection', (socket) => {
  console.log('New client:', socket.id);

  socket.on('join-room', (data) => {
    const { roomCode, adminCode, chosenName, savedName, savedColor } = data;
    if (roomCode !== FIXED_ROOM) {
      socket.emit('error', 'Invalid room code');
      return;
    }

    // Determine name: priority chosenName from index, else savedName, else random
    let rawName = null;
    if (chosenName && isValidName(chosenName)) {
      rawName = chosenName.trim();
    } else if (savedName && isValidName(savedName)) {
      rawName = savedName.trim();
    }
    
    let finalName = rawName;
    if (!finalName) {
      finalName = generateRandomName();
    } else {
      // If name already taken, add a number suffix
      let uniqueName = finalName;
      let counter = 1;
      while (usedNames.has(uniqueName)) {
        uniqueName = `${finalName}${counter}`;
        counter++;
      }
      finalName = uniqueName;
      usedNames.add(finalName);
    }

    let isAdmin = false;
    if (adminCode === ADMIN_CODE && currentAdminCount < MAX_ADMINS) {
      isAdmin = true;
      currentAdminCount++;
    } else if (adminCode === ADMIN_CODE && currentAdminCount >= MAX_ADMINS) {
      socket.emit('error', 'Maximum 4 admins already');
      return;
    }

    const color = (savedColor && COLORS.includes(savedColor)) ? savedColor : COLORS[Math.floor(Math.random() * COLORS.length)];

    const user = {
      id: socket.id,
      name: finalName,
      color,
      room: FIXED_ROOM,
      isAdmin,
      isMuted: false
    };
    activeUsers.set(socket.id, user);
    socket.join(FIXED_ROOM);

    socket.emit('join-success', {
      user: { id: socket.id, name: finalName, color, isAdmin, isMuted: false },
      users: getRoomUsers(),
      history: chatHistory
    });

    socket.to(FIXED_ROOM).emit('user-joined', {
      user: { id: socket.id, name: finalName, color, isAdmin },
      users: getRoomUsers()
    });
    broadcastUserList();
    console.log(`${finalName} joined (admin:${isAdmin})`);
  });

  // Send message
  socket.on('send-message', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;
    if (user.isMuted) {
      socket.emit('error', 'You are muted');
      return;
    }

    const message = {
      id: Date.now(),
      sender: user.name,
      color: user.color,
      timestamp: new Date().toISOString(),
      isAdmin: user.isAdmin,
      mentions: data.mentions || []
    };

    if (data.type === 'image') {
      message.type = 'image';
      message.imageData = data.imageData;
      message.viewOnce = data.viewOnce || false;
      message.viewedBy = new Set();
    } else {
      message.type = 'text';
      message.content = data.content;
    }

    addToHistory(message);
    io.to(FIXED_ROOM).emit('new-message', message);

    // Send mention notifications to mentioned users
    if (message.mentions && message.mentions.length) {
      const mentionedNames = message.mentions;
      for (const [sid, u] of activeUsers.entries()) {
        if (mentionedNames.includes(u.name)) {
          io.to(sid).emit('mention-notification', {
            from: user.name,
            messagePreview: data.content ? data.content.substring(0, 50) : '📷 image'
          });
        }
      }
    }
  });

  // View image
  socket.on('view-image', (messageId) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;
    const msg = chatHistory.find(m => m.id == messageId);
    if (msg && msg.viewOnce && msg.imageData) {
      if (!msg.viewedBy) msg.viewedBy = new Set();
      if (!msg.viewedBy.has(user.id)) {
        msg.viewedBy.add(user.id);
        io.to(FIXED_ROOM).emit('image-viewed', { messageId, viewerId: user.id, viewerName: user.name });
        tryDeleteViewOnceImage(msg);
      }
    }
  });

  // Admin mute
  socket.on('mute-user', (targetUserId) => {
    const admin = activeUsers.get(socket.id);
    if (!admin || !admin.isAdmin) {
      socket.emit('error', 'Only admins can mute');
      return;
    }
    const target = activeUsers.get(targetUserId);
    if (!target) return;
    if (target.isAdmin) {
      socket.emit('error', 'Cannot mute another admin');
      return;
    }
    target.isMuted = !target.isMuted;
    io.to(FIXED_ROOM).emit('user-muted', { userId: targetUserId, userName: target.name, isMuted: target.isMuted });
    broadcastUserList();
    const targetSocket = io.sockets.sockets.get(targetUserId);
    if (targetSocket) targetSocket.emit('mute-status', { isMuted: target.isMuted });
  });

  // Admin kick
  socket.on('kick-user', (targetUserId) => {
    const admin = activeUsers.get(socket.id);
    if (!admin || !admin.isAdmin) {
      socket.emit('error', 'Only admins can kick');
      return;
    }
    const target = activeUsers.get(targetUserId);
    if (!target) return;
    if (target.isAdmin) {
      socket.emit('error', 'Cannot kick another admin');
      return;
    }
    io.to(FIXED_ROOM).emit('user-kicked', { userId: targetUserId, userName: target.name });
    const targetSocket = io.sockets.sockets.get(targetUserId);
    if (targetSocket) {
      targetSocket.emit('kicked', { message: 'You were kicked by an admin' });
      targetSocket.leave(FIXED_ROOM);
    }
    usedNames.delete(target.name);
    activeUsers.delete(targetUserId);
    broadcastUserList();
  });

  // Typing
  socket.on('typing', (isTyping) => {
    const user = activeUsers.get(socket.id);
    if (user) {
      socket.to(FIXED_ROOM).emit('user-typing', { name: user.name, isTyping });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      if (user.isAdmin) currentAdminCount--;
      io.to(FIXED_ROOM).emit('user-left', { userId: socket.id, userName: user.name });
      usedNames.delete(user.name);
      activeUsers.delete(socket.id);
      broadcastUserList();
    }
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', users: activeUsers.size, admins: currentAdminCount }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
