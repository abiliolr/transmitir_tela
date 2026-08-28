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
let token = crypto.randomBytes(8).toString('hex');
const ROOM_NAME = 'stream-room';

// Função para obter o IP da rede local (LAN)
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}
const MAX_VIEWERS = 8;

// Middleware para servir arquivos estáticos de 'public' (exceto index.html que é o host)
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
let lastCloudflareUrl = null;

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

    // Evento para o host solicitar rotação do token
    socket.on('rotate-token', () => {
        if (socket.id !== hostId) {
            socket.emit('error', 'Apenas o Host pode alterar o token.');
            return;
        }

        // Gerar novo token
        token = crypto.randomBytes(8).toString('hex');
        console.log(`\n[Token Rotated] Novo token gerado: ${token}`);

        // Notificar e desconectar todos os viewers conectados
        const room = io.sockets.adapter.rooms.get(ROOM_NAME);
        if (room) {
            for (const socketId of room) {
                if (socketId !== hostId) {
                    const viewerSocket = io.sockets.sockets.get(socketId);
                    if (viewerSocket) {
                        viewerSocket.emit('error', 'O link de transmissão foi alterado pelo Host.');
                        viewerSocket.disconnect();
                    }
                }
            }
        }
        viewers = 0;

        // Informar o host sobre o novo token
        socket.emit('token-rotated', {
            newToken: token,
            watchPath: `/watch/${token}`
        });

        // Se houver túnel do Cloudflare rodando, logar o novo link no terminal
        if (lastCloudflareUrl) {
            const novoLinkCompleto = `${lastCloudflareUrl}/watch/${token}`;
            https.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(novoLinkCompleto)}`, (resp) => {
                let linkCurto = '';
                resp.on('data', chunk => linkCurto += chunk);
                resp.on('end', () => {
                    console.log('========================================================');
                    if (linkCurto.includes('Error')) {
                        console.log(`NOVO LINK ORIGINAL: ${novoLinkCompleto}`);
                    } else {
                        console.log(`NOVO LINK ENCURTADO: ${linkCurto}`);
                    }
                    console.log('========================================================\n');
                });
            }).on('error', () => {
                console.log(`NOVO LINK ORIGINAL: ${novoLinkCompleto}\n`);
            });
        } else {
            const localIp = getLocalIp();
            console.log(`NOVO LINK LOCAL: http://${localIp}:${PORT}/watch/${token}\n`);
        }
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

// Exibir fallback de rede local
function mostrarFallbackRedeLocal(motivo) {
    const localIp = getLocalIp();
    const localWatchUrl = `http://${localIp}:${PORT}/watch/${token}`;
    console.log('\n========================================================');
    console.log(`CLOUDFLARED INDISPONÍVEL / FALHOU (${motivo})`);
    console.log('USANDO MODO DE REDE LOCAL (LAN FALLBACK):');
    console.log(`Link para assistir na mesma rede: ${localWatchUrl}`);
    console.log('========================================================\n');
}

// Automação do Cloudflare Tunnel
function iniciarCloudflareTunnel() {
    const isWindows = os.platform() === 'win32';
    const cloudflaredCmd = isWindows ? 'cloudflared.exe' : 'cloudflared';
    const comandoExato = path.join(__dirname, cloudflaredCmd);
    
    console.log('Iniciando Cloudflare Tunnel...');
    
    let tunnelCreated = false;
    let tunnel;

    try {
        tunnel = spawn(comandoExato, ['tunnel', '--url', `http://localhost:${PORT}`]);
    } catch (err) {
        mostrarFallbackRedeLocal(err.message);
        return;
    }

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
            tunnelCreated = true;
            lastCloudflareUrl = urlMatch[0];
            const cfUrl = lastCloudflareUrl;
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
        if (!tunnelCreated) {
            mostrarFallbackRedeLocal('Executável não encontrado ou erro de execução');
        }
    });

    tunnel.on('close', (code) => {
        console.log(`Cloudflare tunnel processo encerrado com código ${code}`);
        if (!tunnelCreated) {
            mostrarFallbackRedeLocal('Processo encerrado antes de criar o túnel');
        }
    });
}