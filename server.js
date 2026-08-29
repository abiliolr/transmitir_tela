const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const mediasoup = require('mediasoup');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 8080;
const MAX_VIEWERS = 20;

// Estado para armazenar dados de cada sala:
// roomId -> { hostId, viewersCount, router, hostTransport, videoProducer, audioProducer, viewers: { socketId -> { transport, consumers: [] } } }
const rooms = {};

// Mediasoup Worker
let worker;

async function createWorker() {
    worker = await mediasoup.createWorker({
        logLevel: 'warn',
        rtcMinPort: 2000,
        rtcMaxPort: 2020,
    });

    console.log(`Worker PID: ${worker.pid}`);

    worker.on('died', () => {
        console.error('mediasoup Worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
        setTimeout(() => process.exit(1), 2000);
    });
}
createWorker();

// Codecs suportados
const mediaCodecs = [
    {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
    },
    {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
            'x-google-start-bitrate': 1000
        }
    }
];

// Helper para criar um WebRtcTransport
async function createWebRtcTransport(router) {
    const transport = await router.createWebRtcTransport({
        listenIps: [
            {
                ip: '0.0.0.0', // Escuta em todas as interfaces
                announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1' // Trocar pelo IP público na nuvem
            }
        ],
        enableUdp: true,
        enableTcp: true, // Crucial para firewalls / restrições PaaS
        preferUdp: false,
        initialAvailableOutgoingBitrate: 1000000
    });

    transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed' || dtlsState === 'failed') {
            transport.close();
        }
    });

    transport.on('close', () => {
        console.log('transport closed');
    });

    return transport;
}

// Middleware para servir arquivos estáticos de 'public'
app.use(express.static('public', { index: false }));

// Rota de configuração WebRTC (STUN / TURN)
app.get('/api/rtc-config', (req, res) => {
    const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
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

// Rotas do Front
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));
app.get('/create-room', (req, res) => res.redirect(`/host/${crypto.randomBytes(4).toString('hex')}`));
app.get('/host/:roomId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/watch/:roomId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'watch.html')));


// Socket.io - Mediasoup SFU Signaling
io.on('connection', (socket) => {
    console.log(`Nova conexão Socket: ${socket.id}`);

    // ==========================================
    // LÓGICA DO HOST
    // ==========================================

    socket.on('register-host', async (roomId, callback) => {
        try {
            if (!rooms[roomId]) {
                const router = await worker.createRouter({ mediaCodecs });
                rooms[roomId] = {
                    hostId: socket.id,
                    viewersCount: 0,
                    router,
                    hostTransport: null,
                    videoProducer: null,
                    audioProducer: null,
                    viewers: {} // socketId -> { transport, consumers }
                };
            } else {
                rooms[roomId].hostId = socket.id;
            }

            socket.roomId = roomId;
            socket.isHost = true;
            socket.join(roomId);
            console.log(`Host registrado na sala ${roomId}: ${socket.id}`);

            // Envia o rtpCapabilities do Router para o Device do Host
            callback({ rtpCapabilities: rooms[roomId].router.rtpCapabilities });
        } catch (err) {
            console.error(err);
            if (callback) callback({ error: err.message });
        }
    });

    socket.on('create-host-transport', async (_, callback) => {
        try {
            const room = rooms[socket.roomId];
            if (!room) return callback({ error: 'Sala não encontrada' });

            const transport = await createWebRtcTransport(room.router);
            room.hostTransport = transport;

            callback({
                params: {
                    id: transport.id,
                    iceParameters: transport.iceParameters,
                    iceCandidates: transport.iceCandidates,
                    dtlsParameters: transport.dtlsParameters
                }
            });
        } catch (err) {
            console.error(err);
            callback({ error: err.message });
        }
    });

    socket.on('connect-host-transport', async ({ dtlsParameters }, callback) => {
        try {
            const room = rooms[socket.roomId];
            if (!room || !room.hostTransport) return;

            await room.hostTransport.connect({ dtlsParameters });
            callback();
        } catch (err) {
            console.error(err);
            callback({ error: err.message });
        }
    });

    socket.on('produce', async ({ kind, rtpParameters }, callback) => {
        try {
            const room = rooms[socket.roomId];
            if (!room || !room.hostTransport) return;

            const producer = await room.hostTransport.produce({ kind, rtpParameters });

            if (kind === 'video') room.videoProducer = producer;
            else if (kind === 'audio') room.audioProducer = producer;

            producer.on('transportclose', () => {
                producer.close();
            });

            // Avisa a todos os viewers atuais que há uma nova track disponível
            socket.to(socket.roomId).emit('new-producer', { producerId: producer.id, kind });

            callback({ id: producer.id });
        } catch (err) {
            console.error(err);
            callback({ error: err.message });
        }
    });


    // ==========================================
    // LÓGICA DO VIEWER
    // ==========================================

    socket.on('join-room', (roomId, callback) => {
        const room = rooms[roomId];
        if (!room || !room.hostId) {
            socket.emit('error', 'Sala não existe ou o host ainda não iniciou a transmissão.');
            socket.disconnect();
            return;
        }

        if (room.viewersCount >= MAX_VIEWERS) {
            socket.emit('error', 'Sala cheia. Máximo de espectadores atingido.');
            socket.disconnect();
            return;
        }

        socket.roomId = roomId;
        socket.isHost = false;
        socket.join(roomId);

        room.viewersCount++;
        room.viewers[socket.id] = { transport: null, consumers: [] };
        console.log(`Viewer conectado na sala ${roomId}: ${socket.id}. Total: ${room.viewersCount}`);

        io.to(room.hostId).emit('viewer-joined', socket.id);

        callback({
            rtpCapabilities: room.router.rtpCapabilities,
            producers: [
                room.videoProducer ? { id: room.videoProducer.id, kind: 'video' } : null,
                room.audioProducer ? { id: room.audioProducer.id, kind: 'audio' } : null
            ].filter(Boolean)
        });
    });

    socket.on('create-viewer-transport', async (_, callback) => {
        try {
            const room = rooms[socket.roomId];
            if (!room) return callback({ error: 'Sala não encontrada' });

            const transport = await createWebRtcTransport(room.router);
            room.viewers[socket.id].transport = transport;

            callback({
                params: {
                    id: transport.id,
                    iceParameters: transport.iceParameters,
                    iceCandidates: transport.iceCandidates,
                    dtlsParameters: transport.dtlsParameters
                }
            });
        } catch (err) {
            console.error(err);
            callback({ error: err.message });
        }
    });

    socket.on('connect-viewer-transport', async ({ dtlsParameters }, callback) => {
        try {
            const room = rooms[socket.roomId];
            if (!room || !room.viewers[socket.id]) return;

            await room.viewers[socket.id].transport.connect({ dtlsParameters });
            callback();
        } catch (err) {
            console.error(err);
            callback({ error: err.message });
        }
    });

    socket.on('consume', async ({ rtpCapabilities, producerId }, callback) => {
        try {
            const room = rooms[socket.roomId];
            if (!room || !room.viewers[socket.id]) return callback({ error: 'Sala ou Viewer não encontrados' });

            if (!room.router.canConsume({ producerId, rtpCapabilities })) {
                return callback({ error: 'Não pode consumir' });
            }

            const transport = room.viewers[socket.id].transport;
            const consumer = await transport.consume({
                producerId,
                rtpCapabilities,
                paused: true, // Inicia pausado nativamente
            });

            room.viewers[socket.id].consumers.push(consumer);

            consumer.on('transportclose', () => {
                consumer.close();
            });

            consumer.on('producerclose', () => {
                socket.emit('producer-closed', { producerId });
                consumer.close();
            });

            callback({
                params: {
                    id: consumer.id,
                    producerId: consumer.producerId,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                }
            });
        } catch (err) {
            console.error(err);
            callback({ error: err.message });
        }
    });

    socket.on('resume-consumer', async ({ consumerId }, callback) => {
        try {
            const room = rooms[socket.roomId];
            if (!room) return;
            const consumer = room.viewers[socket.id].consumers.find(c => c.id === consumerId);
            if (consumer) {
                await consumer.resume();
            }
            callback();
        } catch (err) {
            console.error(err);
            callback({ error: err.message });
        }
    });


    // ==========================================
    // DISCONNECT
    // ==========================================

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];

        if (socket.isHost) {
            console.log(`Host da sala ${roomId} desconectado.`);

            // Avisar viewers daquela sala
            socket.to(roomId).emit('host-disconnected');

            // Limpeza completa do Router SFU
            if (room.router) room.router.close();

            delete rooms[roomId];
        } else {
            room.viewersCount = Math.max(0, room.viewersCount - 1);
            console.log(`Viewer desconectado da sala ${roomId}: ${socket.id}. Total: ${room.viewersCount}`);

            // Limpar resources desse viewer específico
            const viewerData = room.viewers[socket.id];
            if (viewerData) {
                if (viewerData.transport) viewerData.transport.close();
                delete room.viewers[socket.id];
            }

            // Avisa o host da sala (se ainda existir)
            if (room.hostId) {
                io.to(room.hostId).emit('viewer-left', socket.id);
                // Envia o novo total para UI
                io.to(room.hostId).emit('viewers-update', room.viewersCount);
            }
        }
    });
});

// Inicia o Servidor Local
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
