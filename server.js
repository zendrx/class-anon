const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// In-memory stores
const activeUsers = new Map();
const rooms = new Map();

const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7B731'];

function generateAnonymousName() {
    const adjectives = ['Quiet', 'Loud', 'Happy', 'Sleepy', 'Clever', 'Bold', 'Calm', 'Wise', 'Swift', 'Brave'];
    const nouns = ['Panda', 'Tiger', 'Eagle', 'Wolf', 'Fox', 'Owl', 'Hawk', 'Deer', 'Bear', 'Lion'];
    return adjectives[Math.floor(Math.random() * adjectives.length)] + nouns[Math.floor(Math.random() * nouns.length)];
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Serve HTML directly from memory
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Anonymous Chat</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            width: 90%;
            max-width: 1200px;
            height: 85vh;
            display: flex;
            overflow: hidden;
        }
        .sidebar {
            width: 250px;
            background: #f8f9fa;
            border-right: 1px solid #e0e0e0;
            display: flex;
            flex-direction: column;
        }
        .sidebar-header {
            padding: 20px;
            background: #667eea;
            color: white;
        }
        .room-info {
            padding: 20px;
            border-bottom: 1px solid #e0e0e0;
        }
        .room-code {
            font-family: monospace;
            font-size: 20px;
            font-weight: bold;
            background: white;
            padding: 8px;
            border-radius: 8px;
            text-align: center;
            margin-top: 10px;
            cursor: pointer;
            color: #667eea;
        }
        .users-list {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
        }
        .user-item {
            padding: 8px;
            margin-bottom: 5px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .user-color {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }
        .chat {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
        }
        .message {
            margin-bottom: 15px;
            animation: fadeIn 0.3s;
        }
        .message-header {
            display: flex;
            gap: 10px;
            margin-bottom: 5px;
        }
        .message-sender {
            font-weight: bold;
        }
        .message-time {
            font-size: 11px;
            color: #999;
        }
        .message-content {
            color: #333;
            word-wrap: break-word;
        }
        .system-message {
            text-align: center;
            color: #999;
            font-style: italic;
            margin: 10px 0;
        }
        .typing-indicator {
            padding: 10px 20px;
            color: #999;
            font-style: italic;
            font-size: 12px;
        }
        .input-area {
            padding: 20px;
            border-top: 1px solid #e0e0e0;
            display: flex;
            gap: 10px;
        }
        #messageInput {
            flex: 1;
            padding: 10px;
            border: 1px solid #e0e0e0;
            border-radius: 10px;
            outline: none;
            font-size: 14px;
        }
        #sendButton {
            padding: 10px 20px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 10px;
            cursor: pointer;
        }
        #sendButton:hover {
            background: #5a67d8;
        }
        .join-screen {
            text-align: center;
            padding: 40px;
        }
        .join-screen input {
            padding: 10px;
            margin: 10px;
            border: 1px solid #e0e0e0;
            border-radius: 10px;
            width: 200px;
        }
        .join-screen button {
            padding: 10px 20px;
            margin: 10px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 10px;
            cursor: pointer;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body>
    <div id="app"></div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let currentUser = null;
        let currentRoom = null;

        function showJoinScreen() {
            document.getElementById('app').innerHTML = \`
                <div class="container">
                    <div class="join-screen">
                        <h1>✨ Anonymous Chat</h1>
                        <p>Join or create a chat room</p>
                        <input type="text" id="roomCode" placeholder="Room Code (optional)">
                        <br>
                        <button onclick="createRoom()">Create New Room</button>
                        <button onclick="joinRoom()">Join Room</button>
                    </div>
                </div>
            \`;
        }

        function showChatRoom() {
            document.getElementById('app').innerHTML = \`
                <div class="container">
                    <div class="sidebar">
                        <div class="sidebar-header">
                            <h3>Anonymous Chat</h3>
                        </div>
                        <div class="room-info">
                            <div>Room Code:</div>
                            <div class="room-code" onclick="copyRoomCode()">\${currentRoom}</div>
                        </div>
                        <div class="users-list" id="usersList">
                            <div>Loading users...</div>
                        </div>
                    </div>
                    <div class="chat">
                        <div class="messages" id="messages"></div>
                        <div class="typing-indicator" id="typingIndicator"></div>
                        <div class="input-area">
                            <input type="text" id="messageInput" placeholder="Type a message..." onkeypress="handleKeyPress(event)">
                            <button id="sendButton" onclick="sendMessage()">Send</button>
                        </div>
                    </div>
                </div>
            \`;
            
            let typingTimeout;
            const messageInput = document.getElementById('messageInput');
            
            if (messageInput) {
                messageInput.addEventListener('input', () => {
                    socket.emit('typing', true);
                    clearTimeout(typingTimeout);
                    typingTimeout = setTimeout(() => {
                        socket.emit('typing', false);
                    }, 1000);
                });
            }
        }

        window.createRoom = () => {
            socket.emit('create-room');
        };

        window.joinRoom = () => {
            const roomCode = document.getElementById('roomCode').value;
            if (roomCode) {
                socket.emit('join-room', roomCode);
            } else {
                alert('Please enter a room code');
            }
        };

        window.sendMessage = () => {
            const input = document.getElementById('messageInput');
            if (input) {
                const content = input.value.trim();
                if (content) {
                    socket.emit('send-message', { content });
                    input.value = '';
                }
            }
        };

        window.handleKeyPress = (event) => {
            if (event.key === 'Enter') {
                sendMessage();
            }
        };

        window.copyRoomCode = () => {
            navigator.clipboard.writeText(currentRoom);
            alert('Room code copied!');
        };

        function addMessage(message, isSystem = false) {
            const messagesDiv = document.getElementById('messages');
            if (!messagesDiv) return;
            
            const messageDiv = document.createElement('div');
            
            if (isSystem) {
                messageDiv.className = 'system-message';
                messageDiv.textContent = message;
            } else {
                messageDiv.className = 'message';
                messageDiv.innerHTML = \`
                    <div class="message-header">
                        <span class="message-sender" style="color: \${message.color}">\${escapeHtml(message.sender)}</span>
                        <span class="message-time">\${new Date(message.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div class="message-content">\${escapeHtml(message.content)}</div>
                \`;
            }
            
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function updateUsersList(users) {
            const usersDiv = document.getElementById('usersList');
            if (!usersDiv) return;
            
            usersDiv.innerHTML = '<h4>Users Online</h4>';
            users.forEach(user => {
                const userDiv = document.createElement('div');
                userDiv.className = 'user-item';
                userDiv.innerHTML = \`
                    <div class="user-color" style="background: \${user.color}"></div>
                    <span>\${escapeHtml(user.name)}</span>
                \`;
                usersDiv.appendChild(userDiv);
            });
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Socket event handlers
        socket.on('room-created', (data) => {
            currentUser = data.user;
            currentRoom = data.roomCode;
            showChatRoom();
            addMessage('You created this room! Share the code with friends.', true);
        });

        socket.on('joined-room', (data) => {
            currentUser = data.user;
            currentRoom = data.user.room;
            showChatRoom();
            updateUsersList(data.users);
            addMessage(\`You joined as \${data.user.name}\`, true);
        });

        socket.on('chat-history', (messages) => {
            messages.forEach(msg => addMessage(msg));
        });

        socket.on('new-message', (message) => {
            addMessage(message);
        });

        socket.on('user-joined', (data) => {
            addMessage(\`\${data.name} joined the chat\`, true);
            updateUsersList(data.users);
        });

        socket.on('user-left', (data) => {
            addMessage(\`\${data.name} left the chat\`, true);
            updateUsersList(data.users);
        });

        socket.on('user-typing', (data) => {
            const indicator = document.getElementById('typingIndicator');
            if (indicator) {
                if (data.isTyping) {
                    indicator.textContent = \`\${data.name} is typing...\`;
                } else {
                    indicator.textContent = '';
                }
            }
        });

        socket.on('error', (error) => {
            alert(error);
        });

        // Start
        showJoinScreen();
    </script>
</body>
</html>
    `);
});

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

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
        
        socket.emit('chat-history', rooms.get(roomCode).messages);
        
        io.to(roomCode).emit('user-joined', {
            name: anonymousName,
            color: color,
            users: rooms.get(roomCode).users.map(u => ({ name: u.name, color: u.color }))
        });
        
        socket.emit('joined-room', { 
            user: user, 
            users: rooms.get(roomCode).users.map(u => ({ name: u.name, color: u.color }))
        });
        
        console.log(`${anonymousName} joined room: ${roomCode}`);
    });

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
            if (room.messages.length > 100) room.messages.shift();
            
            io.to(user.room).emit('new-message', message);
        }
    });

    socket.on('typing', (isTyping) => {
        const user = activeUsers.get(socket.id);
        if (user) {
            socket.to(user.room).emit('user-typing', {
                name: user.name,
                isTyping: isTyping
            });
        }
    });

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
    console.log(`\n✅ Anonymous chat server running!`);
    console.log(`📍 Open http://localhost:${PORT} in your browser\n`);
});
