const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Store active users and rooms
const activeUsers = new Map(); // socketId -> user object
const usedNames = new Set(); // Track used names globally

// Fixed room code - ONLY this room works
const FIXED_ROOM_CODE = "CODEXZENDRXGREAT";
const ADMIN_CODE = "zendrxmani";
let adminSocketId = null;

const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7B731'];

// Generate unique anonymous name
function generateUniqueName() {
    const adjectives = ['Quiet', 'Loud', 'Happy', 'Sleepy', 'Clever', 'Bold', 'Calm', 'Wise', 'Swift', 'Brave', 
                        'Silly', 'Smart', 'Wild', 'Tiny', 'Giant', 'Magic', 'Cosmic', 'Electric', 'Mystic', 'Rapid'];
    const nouns = ['Panda', 'Tiger', 'Eagle', 'Wolf', 'Fox', 'Owl', 'Hawk', 'Deer', 'Bear', 'Lion', 
                   'Koala', 'Sloth', 'Falcon', 'Raven', 'Cobra', 'Lynx', 'Viper', 'Horse', 'Dragon', 'Phoenix'];
    
    let attempts = 0;
    let name = "";
    do {
        name = adjectives[Math.floor(Math.random() * adjectives.length)] + nouns[Math.floor(Math.random() * nouns.length)];
        attempts++;
        if (attempts > 100) {
            name = "User" + Math.floor(Math.random() * 9999);
            break;
        }
    } while (usedNames.has(name));
    
    usedNames.add(name);
    return name;
}

// Remove name when user leaves
function removeName(name) {
    usedNames.delete(name);
}

// Get all users in room
function getRoomUsers() {
    const users = [];
    for (const [socketId, user] of activeUsers.entries()) {
        if (user.room === FIXED_ROOM_CODE) {
            users.push({
                id: socketId,
                name: user.name,
                color: user.color,
                isAdmin: user.isAdmin || false
            });
        }
    }
    return users;
}

// Broadcast updated user list to everyone
function broadcastUserList() {
    const users = getRoomUsers();
    io.to(FIXED_ROOM_CODE).emit('user-list-update', users);
}

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Join room
    socket.on('join-room', (data) => {
        const { roomCode, adminCode } = data;
        
        // Check if room code is correct
        if (roomCode !== FIXED_ROOM_CODE) {
            socket.emit('error', 'Invalid room code. Only CODEXZENDRXGREAT is allowed.');
            return;
        }
        
        // Check if trying to join as admin
        const isAdmin = (adminCode === ADMIN_CODE);
        
        // If admin already exists and trying to join as admin
        if (isAdmin && adminSocketId) {
            socket.emit('error', 'Admin already exists in the room');
            return;
        }
        
        // Generate unique name
        const anonymousName = generateUniqueName();
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        // Join socket room
        socket.join(FIXED_ROOM_CODE);
        
        // Store user
        const user = {
            id: socket.id,
            name: anonymousName,
            color: color,
            room: FIXED_ROOM_CODE,
            isAdmin: isAdmin
        };
        
        activeUsers.set(socket.id, user);
        
        if (isAdmin) {
            adminSocketId = socket.id;
            console.log(`Admin joined: ${anonymousName}`);
        }
        
        // Send success to new user
        socket.emit('join-success', {
            user: {
                id: socket.id,
                name: anonymousName,
                color: color,
                isAdmin: isAdmin
            },
            isAdmin: isAdmin,
            users: getRoomUsers()
        });
        
        // Send chat history (you can implement message storage)
        socket.emit('chat-history', []);
        
        // Notify everyone else
        socket.to(FIXED_ROOM_CODE).emit('user-joined', {
            user: {
                id: socket.id,
                name: anonymousName,
                color: color,
                isAdmin: isAdmin
            },
            users: getRoomUsers()
        });
        
        // Broadcast updated user list
        broadcastUserList();
        
        console.log(`${anonymousName}${isAdmin ? ' (ADMIN)' : ''} joined room: ${FIXED_ROOM_CODE}`);
    });
    
    // Send message
    socket.on('send-message', (data) => {
        const user = activeUsers.get(socket.id);
        if (!user) return;
        
        const message = {
            id: Date.now(),
            sender: user.name,
            color: user.color,
            content: data.content,
            timestamp: new Date().toISOString(),
            isAdmin: user.isAdmin || false
        };
        
        io.to(FIXED_ROOM_CODE).emit('new-message', message);
    });
    
    // Kick user (admin only)
    socket.on('kick-user', (targetUserId) => {
        const admin = activeUsers.get(socket.id);
        
        // Check if requester is admin
        if (!admin || !admin.isAdmin) {
            socket.emit('error', 'Only admin can kick users');
            return;
        }
        
        // Get target user
        const targetUser = activeUsers.get(targetUserId);
        if (!targetUser) {
            socket.emit('error', 'User not found');
            return;
        }
        
        // Cannot kick admin
        if (targetUser.isAdmin) {
            socket.emit('error', 'Cannot kick admin');
            return;
        }
        
        // Notify everyone
        io.to(FIXED_ROOM_CODE).emit('user-kicked', {
            userId: targetUserId,
            userName: targetUser.name,
            users: getRoomUsers()
        });
        
        // Kick the user
        const targetSocket = io.sockets.sockets.get(targetUserId);
        if (targetSocket) {
            targetSocket.emit('kicked', { message: 'You were kicked by admin' });
            targetSocket.leave(FIXED_ROOM_CODE);
        }
        
        // Remove from active users
        removeName(targetUser.name);
        activeUsers.delete(targetUserId);
        
        // Broadcast updated list
        broadcastUserList();
        
        console.log(`Admin ${admin.name} kicked ${targetUser.name}`);
    });
    
    // Typing indicator
    socket.on('typing', (isTyping) => {
        const user = activeUsers.get(socket.id);
        if (user) {
            socket.to(FIXED_ROOM_CODE).emit('user-typing', {
                name: user.name,
                isTyping: isTyping
            });
        }
    });
    
    // Disconnect
    socket.on('disconnect', () => {
        const user = activeUsers.get(socket.id);
        if (user) {
            // If admin leaves, remove admin status
            if (user.isAdmin) {
                adminSocketId = null;
                console.log(`Admin left: ${user.name}`);
            }
            
            // Notify everyone
            io.to(FIXED_ROOM_CODE).emit('user-left', {
                user: {
                    id: socket.id,
                    name: user.name
                },
                users: getRoomUsers()
            });
            
            // Remove from active users
            removeName(user.name);
            activeUsers.delete(socket.id);
            
            // Broadcast updated list
            broadcastUserList();
            
            console.log(`Disconnected: ${user.name}`);
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        room: FIXED_ROOM_CODE,
        users: activeUsers.size,
        admin: adminSocketId ? true : false
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n✅ Anonymous Chat Server Running`);
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`🔒 Room Code: ${FIXED_ROOM_CODE}`);
    console.log(`👑 Admin Code: ${ADMIN_CODE}`);
    console.log(`📊 Health Check: http://localhost:${PORT}/health\n`);
});
