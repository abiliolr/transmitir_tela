const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const https = require('https'); // Adicionado para fazer a requisição do encurtador

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 8080;
// Gerar token alfanumérico aleatório
const token = crypto.randomBytes(8).toString('hex');
const ROOM_NAME = 'stream-room';
const MAX_VIEWERS = 8;

// Middleware para servir arquivos estáticos de 'public' (exceto index.html que é o host)
app.use(express.static('public', { index: false }));

// Rota raiz: Acesso apenas do Host
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota do viewer com validação do token
app.get('/watch/:token', (req, res) => {
    if (req.params.token !== token) {
        return res.status(403).send('Acesso Negado: Token inválido.');
    }
    res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

// Socket.io - WebRTC signaling
let hostId = null;
let viewers = 0;

io.on('connection', (socket) => {
    console.log(`Nova conexão Socket: ${socket.id}`);

    // Evento para o host se registrar
    socket.on('register-host', () => {
        hostId = socket.id;
        socket.join(ROOM_NAME);
        console.log(`Host registrado: ${socket.id}`);
    });

    // Evento para viewers entrarem (handshake inicial)
    socket.on('join-room', (clientToken) => {
        if (clientToken !== token) {
            socket.emit('error', 'Token inválido');
            socket.disconnect();
            return;
        }

        const room = io.sockets.adapter.rooms.get(ROOM_NAME);
        const numClients = room ? room.size : 0;
        
        // Host (1) + Max Viewers (8)
        if (numClients > MAX_VIEWERS) {
            socket.emit('error', 'Sala cheia. Máximo de espectadores atingido.');
            socket.disconnect();
            return;
        }

        socket.join(ROOM_NAME);
        viewers++;
        console.log(`Viewer conectado: ${socket.id}. Total viewers: ${viewers}`);

        // Avisa o host que um novo viewer entrou
        if (hostId) {
            io.to(hostId).emit('viewer-joined', socket.id);
        }
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
        if (socket.id === hostId) {
            hostId = null;
            console.log('Host desconectado.');
            // Opcional: avisar viewers que host caiu
            io.to(ROOM_NAME).emit('host-disconnected');
        } else {
            // Se estava na sala, decrementa os viewers (simplificado)
            viewers--;
            console.log(`Viewer desconectado: ${socket.id}. Total viewers: ${Math.max(0, viewers)}`);
            if (hostId) {
                io.to(hostId).emit('viewer-left', socket.id);
            }
        }
    });
});

// Inicia o Servidor Local
server.listen(PORT, () => {
    console.log(`Servidor local rodando em http://localhost:${PORT}`);
    iniciarCloudflareTunnel();
});

// Automação do Cloudflare Tunnel
function iniciarCloudflareTunnel() {
    const isWindows = os.platform() === 'win32';
    const cloudflaredCmd = isWindows ? 'cloudflared.exe' : 'cloudflared';
    const comandoExato = path.join(__dirname, cloudflaredCmd);
    
    console.log('Iniciando Cloudflare Tunnel...');
    
    const tunnel = spawn(comandoExato, ['tunnel', '--url', `http://localhost:${PORT}`]);

    // Espião 1: Lê as mensagens normais do Cloudflare
    tunnel.stdout.on('data', (data) => {
        console.log(`[Cloudflare]: ${data.toString().trim()}`);
    });

    // Espião 2: Lê os links e os possíveis erros
    tunnel.stderr.on('data', (data) => {
        const output = data.toString();
        
        // Mantemos o log para você saber o que está acontecendo
        console.log(`[Cloudflare Log]: ${output.trim()}`); 
        
        const urlMatch = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (urlMatch) {
            const cfUrl = urlMatch[0];
            const linkCompleto = `${cfUrl}/watch/${token}`;
            
            // Faz o Node.js chamar a API do TinyURL para encurtar o link
            https.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(linkCompleto)}`, (resp) => {
                let linkCurto = '';
                resp.on('data', chunk => linkCurto += chunk);
                resp.on('end', () => {
                    console.log('\n========================================================');
                    // Se o TinyURL também bloquear, ele devolve a palavra "Error"
                    if (linkCurto.includes('Error')) {
                        console.log('FALHA AO ENCURTAR (Domínio bloqueado). USE O LINK ORIGINAL:');
                        console.log(linkCompleto);
                    } else {
                        console.log('TUNEL CRIADO E ENCURTADO COM SUCESSO!');
                        console.log(`Link para enviar aos seus amigos: ${linkCurto}`);
                    }
                    console.log('========================================================\n');
                });
            }).on('error', (err) => {
                // Se o encurtador falhar por falha de rede, mostra o link original como plano B
                console.log('\n========================================================');
                console.log('FALHA AO ENCURTAR. USE O LINK ORIGINAL ABAIXO:');
                console.log(linkCompleto);
                console.log('========================================================\n');
            });
        }
    });

    tunnel.on('error', (err) => {
        console.error(`Erro ao iniciar Cloudflare Tunnel:`, err.message);
    });

    tunnel.on('close', (code) => {
        console.log(`Cloudflare tunnel processo encerrado com código ${code}`);
    });
}