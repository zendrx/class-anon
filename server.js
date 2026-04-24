const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Simple in-memory store for active users (no DB needed for this)
const activeUsers = new Map(); // socketId -> { id, name, color, room }
const rooms = new Map(); // roomCode -> { users: [], messages: [] }

// Colors for anonymous users
const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7B731'];

// Generate random anonymous name
function generateAnonymousName() {
    const adjectives = ['Quiet', 'Loud', 'Happy', 'Sleepy', 'Clever', 'Bold', 'Calm', 'Wise', 'Swift', 'Brave'];
    const nouns = ['Panda', 'Tiger', 'Eagle', 'Wolf', 'Fox', 'Owl', 'Hawk', 'Deer', 'Bear', 'Lion'];
    return adjectives[Math.floor(Math.random() * adjectives.length)] + nouns[Math.floor(Math.random() * nouns.length)];
}

// Generate random room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Create a new room
    socket.on('create-room', () => {
        const roomCode = generateRoomCode();
        const anonymousName = generateAnonymousName();
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        socket.join(roomCode);
        
        const user = {
            id: socket.id,
            name: anonymousName,
            color: color,
            room: roomCode
        };
        
        activeUsers.set(socket.id, user);
        
        if (!rooms.has(roomCode)) {
            rooms.set(roomCode, { users: [], messages: [] });
        }
        
        rooms.get(roomCode).users.push(user);
        
        socket.emit('room-created', {
            roomCode: roomCode,
            user: user
        });
        
        console.log(`Room created: ${roomCode} by ${anonymousName}`);
    });

    // Join existing room
    socket.on('join-room', (roomCode) => {
        roomCode = roomCode.toUpperCase();
        
        if (!rooms.has(roomCode)) {
            socket.emit('error', 'Room does not exist');
            return;
        }
        
        const anonymousName = generateAnonymousName();
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        socket.join(roomCode);
        
        const user = {
            id: socket.id,
            name: anonymousName,
            color: color,
            room: roomCode
        };
        
        activeUsers.set(socket.id, user);
        rooms.get(roomCode).users.push(user);
        
        // Send chat history
        socket.emit('chat-history', rooms.get(roomCode).messages);
        
        // Notify everyone in room
        io.to(roomCode).emit('user-joined', {
            name: anonymousName,
            color: color,
            users: rooms.get(roomCode).users.map(u => ({ name: u.name, color: u.color }))
        });
        
        socket.emit('joined-room', { user: user, users: rooms.get(roomCode).users.map(u => ({ name: u.name, color: u.color })) });
        
        console.log(`${anonymousName} joined room: ${roomCode}`);
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
            system: false
        };
        
        const room = rooms.get(user.room);
        if (room) {
            room.messages.push(message);
            // Keep only last 100 messages
            if (room.messages.length > 100) room.messages.shift();
            
            io.to(user.room).emit('new-message', message);
        }
    });

    // User typing indicator
    socket.on('typing', (isTyping) => {
        const user = activeUsers.get(socket.id);
        if (user) {
            socket.to(user.room).emit('user-typing', {
                name: user.name,
                isTyping: isTyping
            });
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        const user = activeUsers.get(socket.id);
        if (user) {
            const room = rooms.get(user.room);
            if (room) {
                room.users = room.users.filter(u => u.id !== user.id);
                
                io.to(user.room).emit('user-left', {
                    name: user.name,
                    users: room.users.map(u => ({ name: u.name, color: u.color }))
                });
                
                // Clean up empty rooms
                if (room.users.length === 0) {
                    rooms.delete(user.room);
                    console.log(`Room deleted: ${user.room} (empty)`);
                }
            }
            activeUsers.delete(socket.id);
            console.log(`Disconnected: ${user.name}`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Anonymous chat server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});