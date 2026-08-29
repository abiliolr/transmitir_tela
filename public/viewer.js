const socket = io();
const remoteVideo = document.getElementById('remote-video');
const statusText = document.getElementById('status');

const pathParts = window.location.pathname.split('/');
const roomId = pathParts[pathParts.length - 1];

// =====================================
// MEDIASOUP SFU VIEWER STATE
// =====================================
let device;
let recvTransport;
let consumers = [];
const mediaStream = new MediaStream();
remoteVideo.srcObject = mediaStream; // Prepara a stream receptora

let rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

async function loadRtcConfig() {
    try {
        const res = await fetch('/api/rtc-config');
        if (res.ok) {
            const data = await res.json();
            if (data && data.iceServers) {
                rtcConfig = data;
            }
        }
    } catch (e) {
        console.warn('Não foi possível carregar rtcConfig do servidor:', e);
    }
}

socket.on('connect', async () => {
    statusText.textContent = 'Autenticando na sala e buscando servidor...';
    await loadRtcConfig();

    // Avisa o servidor que quer entrar passando o roomId
    socket.emit('join-room', roomId, async (data) => {
        if (data.error) {
            statusText.textContent = `Erro: ${data.error}`;
            statusText.className = 'text-red-500 font-bold';
            return;
        }

        try {
            // 1. Instanciar o Device Mediasoup
            device = new mediasoupClient.Device();
            await device.load({ routerRtpCapabilities: data.rtpCapabilities });
            console.log('Mediasoup Device loaded for consumption.');

            statusText.textContent = 'Estabelecendo conexão com o servidor...';
            statusText.className = 'text-blue-400';

            // 2. Criar transportadora para Recebimento (RECV)
            socket.emit('create-viewer-transport', {}, async (transportData) => {
                if (transportData.error) {
                    console.error(transportData.error);
                    return;
                }

                // Injeta os iceServers (STUN/TURN) no transport
                const transportParams = {
                    ...transportData.params,
                    iceServers: rtcConfig.iceServers
                };

                recvTransport = device.createRecvTransport(transportParams);

                // 3. Handshake DTLS
                recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                    socket.emit('connect-viewer-transport', { dtlsParameters }, (res) => {
                        if (res && res.error) errback(new Error(res.error));
                        else callback();
                    });
                });

                // Se ao entrar na sala já tiver producers (Host já transmitindo), consumi-los
                if (data.producers && data.producers.length > 0) {
                    for (const producer of data.producers) {
                        await consumeTrack(producer.id);
                    }
                } else {
                    statusText.textContent = 'Aguardando o host iniciar a transmissão...';
                    statusText.className = 'text-yellow-400';
                }
            });

        } catch (err) {
            console.error('Falha ao instanciar Viewer:', err);
            statusText.textContent = 'Falha ao instanciar Viewer.';
            statusText.className = 'text-red-500';
        }
    });
});

// Em caso de erro na entrada da sala
socket.on('error', (message) => {
    statusText.textContent = `Erro: ${message}`;
    statusText.className = 'text-red-500 font-bold';
});

// Se o host criar uma track nova enquanto o Viewer está conectado
socket.on('new-producer', async ({ producerId }) => {
    if (device && recvTransport) {
        await consumeTrack(producerId);
    }
});

// Se o Host fechar a track/producer
socket.on('producer-closed', ({ producerId }) => {
    const idx = consumers.findIndex(c => c.producerId === producerId);
    if (idx !== -1) {
        consumers[idx].close();
        consumers.splice(idx, 1);
    }
});

// Se o host cair/fechar a aba
socket.on('host-disconnected', () => {
    statusText.textContent = 'Host desconectado. A transmissão foi encerrada.';
    statusText.className = 'text-gray-400';

    // Limpar tudo
    consumers.forEach(c => c.close());
    consumers = [];
    if (recvTransport) recvTransport.close();
    remoteVideo.srcObject = null;
});

socket.on('disconnect', () => {
    statusText.textContent = 'Desconectado do servidor.';
    statusText.className = 'text-red-500';
});


async function consumeTrack(producerId) {
    statusText.textContent = 'Recebendo Mídia...';
    statusText.className = 'text-blue-400';

    socket.emit('consume', {
        producerId: producerId,
        rtpCapabilities: device.rtpCapabilities
    }, async (data) => {
        if (data.error) {
            console.error(data.error);
            return;
        }

        const consumer = await recvTransport.consume({
            id: data.params.id,
            producerId: data.params.producerId,
            kind: data.params.kind,
            rtpParameters: data.params.rtpParameters
        });

        consumers.push(consumer);
        mediaStream.addTrack(consumer.track);

        // Resume o consumo (o mediasoup envia pausado nativamente para evitar drop de pacotes)
        socket.emit('resume-consumer', { consumerId: consumer.id }, () => {
            statusText.textContent = 'Transmissão ao vivo.';
            statusText.className = 'text-green-400';
        });
    });
}
