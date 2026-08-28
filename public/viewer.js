const socket = io();
const remoteVideo = document.getElementById('remote-video');
const statusText = document.getElementById('status');

let peerConnection;

// Extrair token da URL
const pathParts = window.location.pathname.split('/');
const token = pathParts[pathParts.length - 1];

// Configuração de STUN/TURN carregada dinamicamente
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

socket.on('connect', () => {
    statusText.textContent = 'Autenticando na sala...';
    // Avisa o servidor que quer entrar passando o token
    socket.emit('join-room', token);
});

// Em caso de erro na entrada da sala
socket.on('error', (message) => {
    statusText.textContent = `Erro: ${message}`;
    statusText.className = 'text-red-500 font-bold';
});

// Quando o Host enviar a Oferta
socket.on('offer', async (hostId, offer) => {
    statusText.textContent = 'Estabelecendo conexão P2P (Recebendo Vídeo)...';
    statusText.className = 'text-blue-400';

    peerConnection = new RTCPeerConnection(rtcConfig);

    // Quando receber a track de mídia do Host
    peerConnection.ontrack = (event) => {
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            statusText.textContent = 'Transmissão ao vivo.';
            statusText.className = 'text-green-400';
        }
    };

    // Enviar ICE Candidates para o Host
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', hostId, event.candidate);
        }
    };

    // Processar a Oferta e criar a Resposta
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', hostId, answer);
    } catch (error) {
        console.error('Erro ao processar oferta:', error);
        statusText.textContent = 'Falha ao processar vídeo.';
        statusText.className = 'text-red-500';
    }
});

// Quando receber ICE Candidate do Host
socket.on('ice-candidate', async (hostId, candidate) => {
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Erro ao adicionar ICE candidate:', e);
        }
    }
});

// Se o host cair
socket.on('host-disconnected', () => {
    statusText.textContent = 'Host desconectado. A transmissão foi encerrada.';
    statusText.className = 'text-gray-400';
    if (peerConnection) {
        peerConnection.close();
    }
    remoteVideo.srcObject = null;
});

socket.on('disconnect', () => {
    statusText.textContent = 'Desconectado do servidor.';
    statusText.className = 'text-red-500';
});