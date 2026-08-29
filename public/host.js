const socket = io();
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const inviteLinkInput = document.getElementById('invite-link');
const copyLinkBtn = document.getElementById('copy-link-btn');
const localVideo = document.getElementById('local-video');
const statusText = document.getElementById('status');
const viewersCount = document.getElementById('viewers-count');
const viewersList = document.getElementById('viewers-list');

// Pegando os seletores da interface
const resSelect = document.getElementById('res-select');
const fpsSelect = document.getElementById('fps-select');
const codecSelect = document.getElementById('codec-select');
const bitrateSelect = document.getElementById('bitrate-select');

// Verifica suporte de codec do browser e reseta se não suportado
if (codecSelect) {
    codecSelect.addEventListener('change', () => {
        const selectedCodec = codecSelect.value;
        if (selectedCodec !== 'auto' && RTCRtpReceiver.getCapabilities) {
            const capabilities = RTCRtpReceiver.getCapabilities('video');
            const supported = capabilities.codecs.some(codec => codec.mimeType.toLowerCase() === `video/${selectedCodec.toLowerCase()}`);
            if (!supported) {
                alert(`O codec ${selectedCodec} não é suportado pelo seu navegador. Selecionando a opção Auto.`);
                codecSelect.value = 'auto';
            }
        }
    });
}

// Atualiza bitrate ativamente nas conexões de vídeo
if (bitrateSelect) {
    bitrateSelect.addEventListener('change', async () => {
        const selectedBitrate = bitrateSelect.value;
        for (let viewerId in peerConnections) {
            const peerConnection = peerConnections[viewerId];
            const senders = peerConnection.getSenders();
            const videoSender = senders.find(sender => sender.track && sender.track.kind === 'video');
            if (videoSender) {
                const parameters = videoSender.getParameters();
                if (!parameters.encodings) {
                    parameters.encodings = [{}];
                }
                if (selectedBitrate === 'auto') {
                    delete parameters.encodings[0].maxBitrate;
                } else {
                    parameters.encodings[0].maxBitrate = parseInt(selectedBitrate) * 1000;
                }
                try {
                    await videoSender.setParameters(parameters);
                } catch (err) {
                    console.error(`Erro ao definir bitrate para ${viewerId}:`, err);
                }
            }
        }
    });
}

// Extrair roomId da URL
const pathParts = window.location.pathname.split('/');
const roomId = pathParts[pathParts.length - 1];

// Preencher o link de convite automaticamente
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

let localStream;
// Armazena as conexões peer para cada viewer { viewerId: RTCPeerConnection }
const peerConnections = {};

// Configuração do WebRTC contendo STUN e TURN fallback (carregado dinamicamente)
let rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Estrutura para adicionar um servidor TURN hardcoded (apenas para debug/teste local).
        // Em produção, a recomendação é passar isso pelo backend usando variáveis de ambiente.
        // {
        //     urls: "turn:SEU_SERVIDOR_TURN:PORTA",
        //     username: "SEU_USERNAME",
        //     credential: "SEU_PASSWORD"
        // }
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
    socket.emit('register-host', roomId);
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
        const sender = peerConnection.addTrack(track, localStream);
        // Configura o maxBitrate inicial
        if (track.kind === 'video') {
            const selectedBitrate = bitrateSelect ? bitrateSelect.value : 'auto';
            if (selectedBitrate !== 'auto') {
                const parameters = sender.getParameters();
                if (!parameters.encodings) {
                    parameters.encodings = [{}];
                }
                parameters.encodings[0].maxBitrate = parseInt(selectedBitrate) * 1000;
                sender.setParameters(parameters).catch(e => console.error("Erro ao aplicar maxBitrate inicial", e));
            }
        }
    });

    // Configura o Codec de preferência antes de criar a oferta
    if (codecSelect && codecSelect.value !== 'auto' && RTCRtpTransceiver.prototype.setCodecPreferences) {
        const selectedCodec = codecSelect.value;
        const transceivers = peerConnection.getTransceivers();
        const videoTransceiver = transceivers.find(t => t.sender && t.sender.track && t.sender.track.kind === 'video');
        if (videoTransceiver) {
            const capabilities = RTCRtpReceiver.getCapabilities('video');
            if (capabilities) {
                // Filtra os codecs que correspondem ao codec selecionado
                const preferredCodecs = capabilities.codecs.filter(codec => codec.mimeType.toLowerCase() === `video/${selectedCodec.toLowerCase()}`);
                // Além disso, mantemos os outros codecs como fallback, os colocando no final
                const otherCodecs = capabilities.codecs.filter(codec => codec.mimeType.toLowerCase() !== `video/${selectedCodec.toLowerCase()}`);

                try {
                    videoTransceiver.setCodecPreferences([...preferredCodecs, ...otherCodecs]);
                } catch (e) {
                    console.error("Erro ao tentar definir preferência de codec", e);
                }
            }
        }
    }

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