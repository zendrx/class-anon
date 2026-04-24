const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Store active users and rooms
const activeUsers = new Map(); // socketId -> user object
const roomUsers = new Map(); // roomId -> Map of socketId -> user
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

// Serve HTML
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Anonymous Chat - CodexZendrxGreat</title>
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
            width: 260px;
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
        .sidebar-header h3 {
            font-size: 18px;
        }
        .sidebar-header p {
            font-size: 11px;
            opacity: 0.9;
            margin-top: 5px;
        }
        .room-info {
            padding: 20px;
            border-bottom: 1px solid #e0e0e0;
        }
        .room-label {
            font-size: 12px;
            color: #666;
            margin-bottom: 5px;
        }
        .room-code {
            font-family: monospace;
            font-size: 14px;
            font-weight: bold;
            background: #e0e0e0;
            padding: 8px;
            border-radius: 8px;
            text-align: center;
            word-break: break-all;
        }
        .users-list {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
        }
        .users-list h4 {
            margin-bottom: 15px;
            color: #666;
            font-size: 14px;
        }
        .user-item {
            padding: 8px;
            margin-bottom: 8px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: white;
            border: 1px solid #e0e0e0;
        }
        .user-info {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .user-color {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }
        .user-name {
            font-size: 14px;
        }
        .admin-badge {
            background: #ffd700;
            color: #333;
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
            font-weight: bold;
        }
        .kick-btn {
            background: #ff4444;
            color: white;
            border: none;
            padding: 4px 8px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 11px;
            transition: background 0.2s;
        }
        .kick-btn:hover {
            background: #cc0000;
        }
        .kick-btn:disabled {
            background: #ccc;
            cursor: not-allowed;
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
            align-items: baseline;
        }
        .message-sender {
            font-weight: bold;
            font-size: 14px;
        }
        .message-time {
            font-size: 10px;
            color: #999;
        }
        .message-content {
            color: #333;
            word-wrap: break-word;
            font-size: 14px;
        }
        .system-message {
            text-align: center;
            color: #999;
            font-style: italic;
            margin: 10px 0;
            font-size: 12px;
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
            padding: 12px;
            border: 1px solid #e0e0e0;
            border-radius: 10px;
            outline: none;
            font-size: 14px;
        }
        #messageInput:focus {
            border-color: #667eea;
        }
        #sendButton {
            padding: 12px 24px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-weight: bold;
        }
        #sendButton:hover {
            background: #5a67d8;
        }
        .join-screen {
            text-align: center;
            padding: 40px;
        }
        .join-screen h1 {
            margin-bottom: 10px;
        }
        .join-screen .room-info {
            background: #f0f0f0;
            border-radius: 10px;
            margin: 20px 0;
            padding: 15px;
        }
        .join-screen input {
            padding: 12px;
            margin: 10px;
            border: 1px solid #e0e0e0;
            border-radius: 10px;
            width: 250px;
            font-size: 14px;
        }
        .join-screen button {
            padding: 12px 24px;
            margin: 10px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
        }
        .join-screen button:hover {
            background: #5a67d8;
        }
        .admin-section {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #e0e0e0;
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
        let isAdmin = false;

        function showJoinScreen() {
            document.getElementById('app').innerHTML = \`
                <div class="container">
                    <div class="join-screen">
                        <h1>✨ CodexZendrxGreat Chat</h1>
                        <p>Anonymous & Secure</p>
                        <div class="room-info">
                            <strong>Room Code:</strong> CODEXZENDRXGREAT
                        </div>
                        <input type="text" id="adminCode" placeholder="Admin code (optional)">
                        <br>
                        <button onclick="joinChat()">Join Chat</button>
                    </div>
                </div>
            \`;
        }

        function showChatRoom() {
            document.getElementById('app').innerHTML = \`
                <div class="container">
                    <div class="sidebar">
                        <div class="sidebar-header">
                            <h3>✨ CodexZendrxGreat</h3>
                            <p>Anonymous Chat Room</p>
                        </div>
                        <div class="room-info">
                            <div class="room-label">Room Code</div>
                            <div class="room-code">CODEXZENDRXGREAT</div>
                        </div>
                        <div class="users-list">
                            <h4>Online Users (\${isAdmin ? 'Admin Mode' : ''})</h4>
                            <div id="usersList"></div>
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

        window.joinChat = () => {
            const adminCode = document.getElementById('adminCode').value;
            socket.emit('join-room', { roomCode: 'CODEXZENDRXGREAT', adminCode: adminCode });
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

        window.kickUser = (userId) => {
            socket.emit('kick-user', userId);
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
            
            usersDiv.innerHTML = '';
            users.forEach(user => {
                const userDiv = document.createElement('div');
                userDiv.className = 'user-item';
                userDiv.innerHTML = \`
                    <div class="user-info">
                        <div class="user-color" style="background: \${user.color}"></div>
                        <span class="user-name">\${escapeHtml(user.name)}</span>
                        \${user.isAdmin ? '<span class="admin-badge">ADMIN</span>' : ''}
                    </div>
                    \${isAdmin && !user.isAdmin ? '<button class="kick-btn" onclick="kickUser(\\'' + user.id + '\\')">Kick</button>' : ''}
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
        socket.on('join-success', (data) => {
            currentUser = data.user;
            isAdmin = data.isAdmin;
            showChatRoom();
            updateUsersList(data.users);
            addMessage(\`You joined as \${data.user.name}\`, true);
            if (data.isAdmin) {
                addMessage('🔧 You are the ADMIN. Click the Kick button next to any user to remove them.', true);
            }
        });

        socket.on('chat-history', (messages) => {
            messages.forEach(msg => addMessage(msg));
        });

        socket.on('new-message', (message) => {
            addMessage(message);
        });

        socket.on('user-joined', (data) => {
            addMessage(\`✨ \${data.user.name} joined the chat\`, true);
            if (typeof updateUsersList === 'function') {
                updateUsersList(data.users);
            }
        });

        socket.on('user-left', (data) => {
            addMessage(\`👋 \${data.user.name} left the chat\`, true);
            if (typeof updateUsersList === 'function') {
                updateUsersList(data.users);
            }
        });

        socket.on('user-kicked', (data) => {
            addMessage(\`⚠️ \${data.userName} was kicked by admin\`, true);
            if (typeof updateUsersList === 'function') {
                updateUsersList(data.users);
            }
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

        socket.on
