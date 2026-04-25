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
const chatHistory = [];             // stores message objects
const MAX_HISTORY = 200;

const FIXED_ROOM = "CODEXZENDRXGREAT";
const ADMIN_CODE = "zendrxmani";
const MAX_ADMINS = 4;
let currentAdminCount = 0;

const COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7B731'];

function generateUniqueName() {
  const adj = ['Quiet','Loud','Happy','Sleepy','Clever','Bold','Calm','Wise','Swift','Brave','Silly','Smart','Wild','Tiny','Giant','Magic','Cosmic','Electric','Mystic','Rapid'];
  const nouns = ['Panda','Tiger','Eagle','Wolf','Fox','Owl','Hawk','Deer','Bear','Lion','Koala','Sloth','Falcon','Raven','Cobra','Lynx','Viper','Horse','Dragon','Phoenix'];
  let name;
  do { name = adj[Math.floor(Math.random()*adj.length)] + nouns[Math.floor(Math.random()*nouns.length)]; } while (usedNames.has(name));
  usedNames.add(name);
  return name;
}
function removeName(name) { usedNames.delete(name); }

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

// Clean up view-once image if all current users have viewed it
function tryDeleteViewOnceImage(message) {
  if (!message.viewOnce) return;
  const currentUserIds = new Set(Array.from(activeUsers.keys()));
  const viewers = message.viewedBy || new Set();
  // Check if every active user has viewed the image
  let allViewed = true;
  for (let uid of currentUserIds) {
    if (!viewers.has(uid)) {
      allViewed = false;
      break;
    }
  }
  if (allViewed && message.imageData) {
    message.imageData = null; // free memory
    io.to(FIXED_ROOM).emit('image-expired', { messageId: message.id });
    console.log(`View-once image ${message.id} deleted (all ${currentUserIds.size} users saw it)`);
  }
}

io.on('connection', (socket) => {
  console.log('New client:', socket.id);

  socket.on('join-room', (data) => {
    const { roomCode, adminCode, savedName, savedColor } = data;
    if (roomCode !== FIXED_ROOM) {
      socket.emit('error', 'Invalid room code');
      return;
    }

    let isAdmin = false;
    if (adminCode === ADMIN_CODE && currentAdminCount < MAX_ADMINS) {
      isAdmin = true;
      currentAdminCount++;
    } else if (adminCode === ADMIN_CODE && currentAdminCount >= MAX_ADMINS) {
      socket.emit('error', 'Maximum 4 admins already');
      return;
    }

    let name = (savedName && !usedNames.has(savedName)) ? savedName : generateUniqueName();
    const color = (savedColor && COLORS.includes(savedColor)) ? savedColor : COLORS[Math.floor(Math.random() * COLORS.length)];

    const user = {
      id: socket.id,
      name,
      color,
      room: FIXED_ROOM,
      isAdmin,
      isMuted: false
    };
    activeUsers.set(socket.id, user);
    socket.join(FIXED_ROOM);

    socket.emit('join-success', {
      user: { id: socket.id, name, color, isAdmin, isMuted: false },
      users: getRoomUsers(),
      history: chatHistory
    });

    socket.to(FIXED_ROOM).emit('user-joined', {
      user: { id: socket.id, name, color, isAdmin },
      users: getRoomUsers()
    });
    broadcastUserList();
    console.log(`${name} joined (admin:${isAdmin})`);
  });

  // Send message (text or image)
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
      message.imageData = data.imageData;   // base64 string
      message.viewOnce = data.viewOnce || false;
      message.viewedBy = new Set();          // store user IDs who have seen it
      if (!message.viewOnce) {
        // non-view-once images stay forever
      }
    } else {
      message.type = 'text';
      message.content = data.content;
    }

    addToHistory(message);
    io.to(FIXED_ROOM).emit('new-message', message);
  });

  // Mark image as viewed (for view-once)
  socket.on('view-image', (messageId) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;
    const msg = chatHistory.find(m => m.id == messageId);
    if (msg && msg.viewOnce && msg.imageData) {
      if (!msg.viewedBy) msg.viewedBy = new Set();
      if (!msg.viewedBy.has(user.id)) {
        msg.viewedBy.add(user.id);
        io.to(FIXED_ROOM).emit('image-viewed', { messageId, viewerId: user.id, viewerName: user.name });
        // Try to delete if all have seen
        tryDeleteViewOnceImage(msg);
      }
    }
  });

  // Admin: Mute user
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

  // Admin: Kick user
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
      targetSocket.emit('kicked', { message: 'You were kicked' });
      targetSocket.leave(FIXED_ROOM);
    }
    removeName(target.name);
    activeUsers.delete(targetUserId);
    broadcastUserList();
  });

  // Typing indicator
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
      removeName(user.name);
      activeUsers.delete(socket.id);
      broadcastUserList();

      // Re-check all view-once images: if a user left, they cannot view, so maybe we don't delete?
      // We'll leave as is; image will only be deleted when all *current* users have viewed.
      // That's fine.
    }
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', admins: currentAdminCount, users: activeUsers.size }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
