const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

app.use(cors({
    origin: '*',
    credentials: true
}));

const io = socketIO(server, {
    cors: {
        origin: '*',
        methods: ["GET", "POST"],
        credentials: true
    }
});

let streamerSocket = null;
let viewers = new Map();
let streamActive = false;
let chatHistory = [];

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        streamActive: streamActive,
        viewers: viewers.size,
        streamer: streamerSocket ? 'connected' : 'disconnected'
    });
});

io.on('connection', (socket) => {
    console.log('Nueva conexión:', socket.id);
    
    socket.on('streamer-connect', (data) => {
        console.log('Streamer conectado:', socket.id);
        if (streamerSocket) {
            streamerSocket.disconnect();
        }
        streamerSocket = socket;
        streamActive = false;
        io.emit('streamer-status', { online: true, streaming: false });
    });
    
    socket.on('start-stream', () => {
        if (socket.id !== streamerSocket?.id) return;
        streamActive = true;
        io.emit('stream-started', { streamerId: socket.id });
    });
    
    socket.on('stop-stream', () => {
        if (socket.id !== streamerSocket?.id) return;
        streamActive = false;
        io.emit('stream-stopped');
    });
    
    socket.on('viewer-connect', (data) => {
        viewers.set(socket.id, {
            id: socket.id,
            username: data.username || 'Anónimo',
            connectedAt: Date.now()
        });
        
        socket.emit('current-status', {
            streamActive: streamActive,
            viewerCount: viewers.size,
            chatHistory: chatHistory.slice(-20)
        });
        
        if (streamerSocket) {
            streamerSocket.emit('viewer-count', viewers.size);
        }
        
        if (streamActive && streamerSocket) {
            socket.emit('stream-active', { streamerId: streamerSocket.id });
        }
    });
    
    socket.on('viewer-offer', (data) => {
        if (!streamerSocket) {
            socket.emit('error', { message: 'Streamer no disponible' });
            return;
        }
        streamerSocket.emit('viewer-offer', {
            viewerId: socket.id,
            offer: data.offer
        });
    });
    
    socket.on('streamer-answer', (data) => {
        const viewerSocket = io.sockets.sockets.get(data.viewerId);
        if (viewerSocket) {
            viewerSocket.emit('streamer-answer', { answer: data.answer });
        }
    });
    
    socket.on('viewer-ice-candidate', (data) => {
        if (streamerSocket) {
            streamerSocket.emit('viewer-ice-candidate', {
                viewerId: socket.id,
                candidate: data.candidate
            });
        }
    });
    
    socket.on('streamer-ice-candidate', (data) => {
        const viewerSocket = io.sockets.sockets.get(data.viewerId);
        if (viewerSocket) {
            viewerSocket.emit('streamer-ice-candidate', {
                candidate: data.candidate
            });
        }
    });
    
    socket.on('chat-message', (data) => {
        const timestamp = Date.now();
        let username = 'Anónimo';
        let userType = 'viewer';
        
        if (socket.id === streamerSocket?.id) {
            username = 'SIMON';
            userType = 'streamer';
        } else {
            const viewer = viewers.get(socket.id);
            if (viewer) {
                username = viewer.username;
            }
        }
        
        const message = {
            id: `${socket.id}-${timestamp}`,
            username: username,
            text: data.text,
            type: userType,
            timestamp: timestamp
        };
        
        chatHistory.push(message);
        if (chatHistory.length > 50) {
            chatHistory.shift();
        }
        
        io.emit('chat-message', message);
    });
    
    socket.on('disconnect', () => {
        if (socket.id === streamerSocket?.id) {
            streamerSocket = null;
            streamActive = false;
            io.emit('streamer-disconnected');
            io.emit('stream-stopped');
        }
        
        if (viewers.has(socket.id)) {
            viewers.delete(socket.id);
            if (streamerSocket) {
                streamerSocket.emit('viewer-count', viewers.size);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
