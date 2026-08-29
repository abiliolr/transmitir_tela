const socket = io();
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const inviteLinkInput = document.getElementById('invite-link');
const copyLinkBtn = document.getElementById('copy-link-btn');
const localVideo = document.getElementById('local-video');
const statusText = document.getElementById('status');
const viewersCount = document.getElementById('viewers-count');
const viewersList = document.getElementById('viewers-list');

const resSelect = document.getElementById('res-select');
const fpsSelect = document.getElementById('fps-select');

const pathParts = window.location.pathname.split('/');
const roomId = pathParts[pathParts.length - 1];

const inviteUrl = `${window.location.origin}/watch/${roomId}`;
if (inviteLinkInput) {
    inviteLinkInput.value = inviteUrl;
}

if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
        inviteLinkInput.select();
        document.execCommand('copy');
        copyLinkBtn.textContent = 'Copiado!';
        copyLinkBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
        copyLinkBtn.classList.add('bg-gray-600', 'hover:bg-gray-700');
        setTimeout(() => {
            copyLinkBtn.textContent = 'Copiar';
            copyLinkBtn.classList.remove('bg-gray-600', 'hover:bg-gray-700');
            copyLinkBtn.classList.add('bg-green-600', 'hover:bg-green-700');
        }, 2000);
    });
}

// =====================================
// MEDIASOUP SFU HOST STATE
// =====================================
let localStream;
let device;
let sendTransport;
let videoProducer;
let audioProducer;
// Como no SFU o host não conecta direto com o viewer, as peerConnections P2P não existem mais.
// O backend vai notificar o total de viewers e a lista (idenidade) se desejarmos.

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

// Ao conectar no servidor, registrar-se como Host SFU
socket.on('connect', async () => {
    console.log('Conectado ao servidor.');
    await loadRtcConfig();

    socket.emit('register-host', roomId, async (data) => {
        if (data.error) {
            statusText.textContent = `Erro: ${data.error}`;
            statusText.classList.add('text-red-500');
            return;
        }

        // 1. Instanciar o device Mediasoup com as capacidades do Router da sala
        try {
            device = new mediasoupClient.Device();
            await device.load({ routerRtpCapabilities: data.rtpCapabilities });
            console.log('Mediasoup Device loaded.');
        } catch (err) {
            console.error('Falha ao instanciar Device:', err);
        }
    });
});

startBtn.addEventListener('click', async () => {
    try {
        if (!device || !device.loaded) {
            alert('Aguarde o carregamento do servidor SFU.');
            return;
        }

        const fpsSelecionado = parseInt(fpsSelect.value);
        const resSelecionada = resSelect.value.split('x');
        const width = parseInt(resSelecionada[0]);
        const height = parseInt(resSelecionada[1]);

        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: { 
                cursor: "always",
                width: { ideal: width, max: width },
                height: { ideal: height, max: height },
                frameRate: { ideal: fpsSelecionado, max: fpsSelecionado }
            },
            audio: true
        });
        
        localVideo.srcObject = localStream;
        
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        statusText.textContent = 'Iniciando Transportadora SFU...';
        statusText.classList.remove('text-gray-400');
        statusText.classList.add('text-blue-400');

        // Se o host parar a stream pelo navegador, limpamos
        localStream.getVideoTracks()[0].onended = () => stopStream();

        // 2. Solicita criação de WebRtcTransport para SEND
        socket.emit('create-host-transport', {}, async (transportData) => {
            if (transportData.error) {
                console.error(transportData.error);
                return;
            }

            // Injeta os iceServers (STUN/TURN) no transport
            const transportParams = {
                ...transportData.params,
                iceServers: rtcConfig.iceServers
            };

            sendTransport = device.createSendTransport(transportParams);

            // 3. Handshake DTLS
            sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                socket.emit('connect-host-transport', { dtlsParameters }, (res) => {
                    if (res && res.error) errback(new Error(res.error));
                    else callback();
                });
            });

            // 4. Transportador avisando que vai produzir Mídia (Notifica Servidor para criar Producer)
            sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
                socket.emit('produce', { kind, rtpParameters }, (res) => {
                    if (res && res.error) errback(new Error(res.error));
                    else callback({ id: res.id });
                });
            });

            // 5. Iniciar produção das Tracks locais para o Servidor!
            const videoTrack = localStream.getVideoTracks()[0];
            const audioTrack = localStream.getAudioTracks()[0];

            if (videoTrack) {
                videoProducer = await sendTransport.produce({ track: videoTrack });
            }
            if (audioTrack) {
                audioProducer = await sendTransport.produce({ track: audioTrack });
            }

            statusText.textContent = 'Transmitindo tela para o servidor com sucesso!';
            statusText.classList.remove('text-blue-400');
            statusText.classList.add('text-green-400');
        });

    } catch (err) {
        console.error("Erro ao acessar a tela: ", err);
        statusText.textContent = 'Erro ao capturar a tela. Verifique as permissões.';
        statusText.classList.remove('text-green-400', 'text-blue-400');
        statusText.classList.add('text-red-500');
    }
});

stopBtn.addEventListener('click', stopStream);

function stopStream() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (videoProducer) videoProducer.close();
    if (audioProducer) audioProducer.close();
    if (sendTransport) sendTransport.close();

    localVideo.srcObject = null;
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    statusText.textContent = 'Transmissão interrompida.';
    statusText.classList.remove('text-green-400', 'text-blue-400', 'text-red-500');
    statusText.classList.add('text-gray-400');
}

// O Servidor emite a contagem e a lista abstrata para UI
let abstractViewers = [];

socket.on('viewer-joined', (viewerId) => {
    if (!abstractViewers.includes(viewerId)) {
        abstractViewers.push(viewerId);
        updateViewersUI();
    }
});

socket.on('viewer-left', (viewerId) => {
    abstractViewers = abstractViewers.filter(id => id !== viewerId);
    updateViewersUI();
});

socket.on('viewers-update', (count) => {
    viewersCount.textContent = count;
});

function updateViewersUI() {
    viewersCount.textContent = abstractViewers.length;
    viewersList.innerHTML = '';
    abstractViewers.forEach(v => {
        const li = document.createElement('li');
        li.textContent = `Viewer ID: ${v.substring(0, 8)}...`;
        viewersList.appendChild(li);
    });
}
