const socket = io();
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const rotateTokenBtn = document.getElementById('rotate-token-btn');
const localVideo = document.getElementById('local-video');
const statusText = document.getElementById('status');
const tokenStatusText = document.getElementById('token-status');
const viewersCount = document.getElementById('viewers-count');
const viewersList = document.getElementById('viewers-list');

// Pegando os seletores da interface
const resSelect = document.getElementById('res-select');
const fpsSelect = document.getElementById('fps-select');

let localStream;
// Armazena as conexões peer para cada viewer { viewerId: RTCPeerConnection }
const peerConnections = {};

// Configuração do WebRTC contendo STUN e TURN fallback (carregado dinamicamente)
let rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
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
        console.warn('Não foi possível carregar rtcConfig do servidor, usando fallback padrão:', e);
    }
}
loadRtcConfig();

// Ao conectar no servidor, registrar-se como Host
socket.on('connect', () => {
    console.log('Conectado ao servidor.');
    socket.emit('register-host');
});

startBtn.addEventListener('click', async () => {
    try {
        // Lendo os valores escolhidos pelo Host
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
        statusText.textContent = 'Transmitindo tela...';
        statusText.classList.remove('text-gray-400');
        statusText.classList.add('text-green-400');

        // Se a stream for parada nativamente pelo navegador
        localStream.getVideoTracks()[0].onended = () => {
            stopStream();
        };
    } catch (err) {
        console.error("Erro ao acessar a tela: ", err);
        statusText.textContent = 'Erro ao capturar a tela. Verifique as permissões.';
        statusText.classList.add('text-red-500');
    }
});

stopBtn.addEventListener('click', stopStream);

rotateTokenBtn.addEventListener('click', () => {
    socket.emit('rotate-token');
});

socket.on('token-rotated', (data) => {
    console.log('Novo token recebido:', data.newToken);
    if (tokenStatusText) {
        tokenStatusText.textContent = `Novo link de transmissão gerado! (Caminho: ${data.watchPath})`;
        tokenStatusText.classList.remove('hidden');
    }
    // Fechar e limpar peerConnections de viewers desconectados
    for (let id in peerConnections) {
        peerConnections[id].close();
        delete peerConnections[id];
    }
    updateViewersUI();
});

function stopStream() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    localVideo.srcObject = null;
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    statusText.textContent = 'Transmissão interrompida.';
    statusText.classList.remove('text-green-400');
    statusText.classList.add('text-gray-400');

    // Desconectar todos os peers
    for (let id in peerConnections) {
        peerConnections[id].close();
        delete peerConnections[id];
    }
    updateViewersUI();
}

// Quando um novo viewer entra na sala
socket.on('viewer-joined', async (viewerId) => {
    console.log(`Novo viewer conectou: ${viewerId}`);
    
    if (!localStream) {
        console.log('Nenhuma stream ativa para enviar.');
        return;
    }

    // Criar nova conexão P2P
    const peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnections[viewerId] = peerConnection;

    // Adicionar as tracks de mídia locais na conexão P2P
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Quando o ICE agent encontrar um candidato de rede
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', viewerId, event.candidate);
        }
    };

    // Criar e enviar a Oferta
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', viewerId, offer);
    } catch (error) {
        console.error("Erro ao criar oferta: ", error);
    }
    
    updateViewersUI();
});

// Quando recebe uma Resposta de um viewer
socket.on('answer', async (viewerId, answer) => {
    const peerConnection = peerConnections[viewerId];
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (e) {
            console.error("Erro ao setar remote description na answer:", e);
        }
    }
});

// Quando recebe um candidato ICE do viewer
socket.on('ice-candidate', async (viewerId, candidate) => {
    const peerConnection = peerConnections[viewerId];
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error("Erro ao adicionar ICE candidate:", e);
        }
    }
});

// Quando um viewer sai
socket.on('viewer-left', (viewerId) => {
    console.log(`Viewer saiu: ${viewerId}`);
    if (peerConnections[viewerId]) {
        peerConnections[viewerId].close();
        delete peerConnections[viewerId];
    }
    updateViewersUI();
});

function updateViewersUI() {
    const viewers = Object.keys(peerConnections);
    viewersCount.textContent = viewers.length;
    
    viewersList.innerHTML = '';
    viewers.forEach(v => {
        const li = document.createElement('li');
        li.textContent = `Viewer ID: ${v.substring(0, 8)}...`;
        viewersList.appendChild(li);
    });
}