const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ----- DATA -----
const activeUsers = new Map();        // socketId -> user
const usedNames = new Set();          // globally used names
const chatHistory = [];               // all messages (persist until restart)
const MAX_HISTORY = 200;

// Room & admin settings
const FIXED_ROOM_CODE = "CODEXZENDRXGREAT";
const ADMIN_CODE = "zendrxmani";      // anyone who provides this becomes admin

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7B731',
  '#FF8C42', '#6C5B7B', '#3D5A80', '#EE6C4D'
];

// ----- Helpers -----
function generateUniqueName() {
  const adjectives = ['Quiet', 'Loud', 'Happy', 'Sleepy', 'Clever', 'Bold',
    'Calm', 'Wise', 'Swift', 'Brave', 'Silly', 'Smart', 'Wild', 'Tiny',
    'Giant', 'Magic', 'Cosmic', 'Electric', 'Mystic', 'Rapid'];
  const nouns = ['Panda', 'Tiger', 'Eagle', 'Wolf', 'Fox', 'Owl', 'Hawk',
    'Deer', 'Bear', 'Lion', 'Koala', 'Sloth', 'Falcon', 'Raven', 'Cobra',
    'Lynx', 'Viper', 'Horse', 'Dragon', 'Phoenix'];
  let name = '';
  let attempts = 0;
  do {
    name = adjectives[Math.floor(Math.random() * adjectives.length)] +
           nouns[Math.floor(Math.random() * nouns.length)];
    attempts++;
    if (attempts > 100) name = 'User' + Math.floor(Math.random() * 9999);
  } while (usedNames.has(name));
  usedNames.add(name);
  return name;
}

function removeName(name) {
  usedNames.delete(name);
}

function getRoomUsers() {
  const users = [];
  for (const [id, user] of activeUsers.entries()) {
    if (user.room === FIXED_ROOM_CODE) {
      users.push({
        id,
        name: user.name,
        color: user.color,
        isAdmin: user.isAdmin
      });
    }
  }
  return users;
}

function broadcastUserList() {
  io.to(FIXED_ROOM_CODE).emit('user-list', getRoomUsers());
}

function addToHistory(message) {
  chatHistory.push(message);
  if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
}

// ----- Socket.IO -----
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // Join room (or rejoin after reload)
  socket.on('join-room', (data) => {
    const { roomCode, adminCode, savedName, savedColor } = data;

    if (roomCode !== FIXED_ROOM_CODE) {
      socket.emit('error', 'Invalid room code. Only CODEXZENDRXGREAT is allowed.');
      return;
    }

    const isAdmin = (adminCode === ADMIN_CODE);

    // Re‑use previous name if still available
    let name;
    if (savedName && !usedNames.has(savedName)) {
      name = savedName;
    } else {
      name = generateUniqueName();
    }

    // Re‑use previous color or pick random
    const color = (savedColor && COLORS.includes(savedColor))
      ? savedColor
      : COLORS[Math.floor(Math.random() * COLORS.length)];

    // Create user object
    const user = {
      id: socket.id,
      name,
      color,
      room: FIXED_ROOM_CODE,
      isAdmin
    };

    activeUsers.set(socket.id, user);
    socket.join(FIXED_ROOM_CODE);

    // Send current user info + full user list + chat history
    socket.emit('join-success', {
      user: { id: socket.id, name, color, isAdmin },
      users: getRoomUsers(),
      history: chatHistory
    });

    // Announce to others
    socket.to(FIXED_ROOM_CODE).emit('user-joined', {
      user: { id: socket.id, name, color, isAdmin },
      users: getRoomUsers()
    });

    broadcastUserList();
    console.log(`${name} (${isAdmin ? 'ADMIN' : 'user'}) joined`);
  });

  // New message
  socket.on('send-message', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;

    const message = {
      id: Date.now(),
      sender: user.name,
      color: user.color,
      content: data.content,
      timestamp: new Date().toISOString(),
      isAdmin: user.isAdmin
    };

    addToHistory(message);
    io.to(FIXED_ROOM_CODE).emit('new-message', message);
  });

  // Kick user (admin only)
  socket.on('kick-user', (targetUserId) => {
    const admin = activeUsers.get(socket.id);
    if (!admin || !admin.isAdmin) {
      socket.emit('error', 'Only admins can kick users');
      return;
    }

    const target = activeUsers.get(targetUserId);
    if (!target) {
      socket.emit('error', 'User not found');
      return;
    }

    if (target.isAdmin) {
      socket.emit('error', 'Cannot kick another admin');
      return;
    }

    // Notify everyone
    io.to(FIXED_ROOM_CODE).emit('user-kicked', {
      userId: targetUserId,
      userName: target.name,
      users: getRoomUsers()
    });

    // Disconnect the kicked user
    const targetSocket = io.sockets.sockets.get(targetUserId);
    if (targetSocket) {
      targetSocket.emit('kicked', { message: 'You were kicked by an admin' });
      targetSocket.leave(FIXED_ROOM_CODE);
    }

    // Clean up
    removeName(target.name);
    activeUsers.delete(targetUserId);
    broadcastUserList();

    console.log(`Admin ${admin.name} kicked ${target.name}`);
  });

  // Typing indicator
  socket.on('typing', (isTyping) => {
    const user = activeUsers.get(socket.id);
    if (user) {
      socket.to(FIXED_ROOM_CODE).emit('user-typing', {
        name: user.name,
        isTyping
      });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      io.to(FIXED_ROOM_CODE).emit('user-left', {
        userId: socket.id,
        userName: user.name,
        users: getRoomUsers()
      });
      removeName(user.name);
      activeUsers.delete(socket.id);
      broadcastUserList();
      console.log(`${user.name} disconnected`);
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    room: FIXED_ROOM_CODE,
    users: activeUsers.size,
    admins: Array.from(activeUsers.values()).filter(u => u.isAdmin).length,
    history: chatHistory.length
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✅ Chat server running on port ${PORT}`);
  console.log(`🔒 Room: ${FIXED_ROOM_CODE}`);
  console.log(`👑 Admin code: ${ADMIN_CODE}`);
});
