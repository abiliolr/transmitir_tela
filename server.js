const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 8080;
const MAX_VIEWERS = 8;

// Estado para armazenar dados de cada sala (roomId -> { hostId, viewersCount })
const rooms = {};

// Middleware para servir arquivos estáticos de 'public' (exceto os HTMLs principais para controle de rota manual)
app.use(express.static('public', { index: false }));

// Rota de configuração WebRTC (STUN / TURN)
app.get('/api/rtc-config', (req, res) => {
    const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ];

    if (process.env.TURN_URL) {
        const turnConfig = {
            urls: process.env.TURN_URL
        };
        if (process.env.TURN_USERNAME) {
            turnConfig.username = process.env.TURN_USERNAME;
        }
        if (process.env.TURN_CREDENTIAL) {
            turnConfig.credential = process.env.TURN_CREDENTIAL;
        }
        iceServers.push(turnConfig);
    }

    res.json({ iceServers });
});

// Nova Rota raiz: Serve a página inicial
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// Rota para criar uma nova sala de transmissão
app.get('/create-room', (req, res) => {
    const roomId = crypto.randomBytes(4).toString('hex');
    res.redirect(`/host/${roomId}`);
});

// Rota para o host da sala
app.get('/host/:roomId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

// Rota do viewer para assistir
app.get('/watch/:roomId', (req, res) => {
    // É possível colocar validação de existência de sala aqui,
    // mas também será validado no socket.io
    res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

// Socket.io - WebRTC signaling isolado por sala
io.on('connection', (socket) => {
    console.log(`Nova conexão Socket: ${socket.id}`);

    // Evento para o host se registrar em uma sala específica
    socket.on('register-host', (roomId) => {
        if (!rooms[roomId]) {
            rooms[roomId] = { hostId: null, viewersCount: 0 };
        }

        // Se já existe um host e ele estiver conectado (opcionalmente derrubar o antigo, mas por simplicidade sobreescrevemos)
        rooms[roomId].hostId = socket.id;
        socket.roomId = roomId; // Vincula o socket à sala
        socket.isHost = true;

        socket.join(roomId);
        console.log(`Host registrado na sala ${roomId}: ${socket.id}`);
    });

    // Evento para viewers entrarem em uma sala específica
    socket.on('join-room', (roomId) => {
        if (!rooms[roomId] || !rooms[roomId].hostId) {
            socket.emit('error', 'Sala não existe ou o host ainda não iniciou a transmissão.');
            socket.disconnect();
            return;
        }

        const roomData = rooms[roomId];
        
        if (roomData.viewersCount >= MAX_VIEWERS) {
            socket.emit('error', 'Sala cheia. Máximo de espectadores atingido.');
            socket.disconnect();
            return;
        }

        socket.roomId = roomId;
        socket.isHost = false;
        socket.join(roomId);

        roomData.viewersCount++;
        console.log(`Viewer conectado na sala ${roomId}: ${socket.id}. Total viewers: ${roomData.viewersCount}`);

        // Avisa apenas o host daquela sala que um novo viewer entrou
        io.to(roomData.hostId).emit('viewer-joined', socket.id);
    });

    // Sinalização: Offer
    socket.on('offer', (id, message) => {
        socket.to(id).emit('offer', socket.id, message);
    });

    // Sinalização: Answer
    socket.on('answer', (id, message) => {
        socket.to(id).emit('answer', socket.id, message);
    });

    // Sinalização: ICE Candidate
    socket.on('ice-candidate', (id, message) => {
        socket.to(id).emit('ice-candidate', socket.id, message);
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;

        const roomData = rooms[roomId];

        if (socket.isHost) {
            console.log(`Host da sala ${roomId} desconectado.`);
            // Avisar viewers daquela sala que o host caiu
            socket.to(roomId).emit('host-disconnected');
            // Remove a sala (opcional, ou espera os viewers desconectarem sozinhos)
            delete rooms[roomId];
        } else {
            roomData.viewersCount = Math.max(0, roomData.viewersCount - 1);
            console.log(`Viewer desconectado da sala ${roomId}: ${socket.id}. Total viewers: ${roomData.viewersCount}`);
            // Avisa o host da sala (se ainda existir)
            if (roomData.hostId) {
                io.to(roomData.hostId).emit('viewer-left', socket.id);
            }
        }
    });
});

// Inicia o Servidor Local
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
