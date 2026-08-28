# transmitir_tela

Aplicação simples de **transmissão de tela P2P via navegador**, criada como alternativa caseira ao compartilhamento de tela do Discord. Um "host" compartilha a própria tela pelo navegador e qualquer pessoa com o link consegue assistir ao vivo, sem precisar instalar nada.

> Projeto pessoal, ainda em teste.

## Como funciona

1. Você roda o servidor local (`node server.js`).
2. O servidor sobe automaticamente um **túnel Cloudflare** (`cloudflared`), gerando uma URL pública para o seu `localhost`.
3. Um **token aleatório** é gerado a cada execução e vira parte do link (`/watch/<token>`) — funciona como uma senha de acesso à transmissão.
4. O servidor tenta **encurtar o link** automaticamente via TinyURL (se falhar, mostra o link completo mesmo).
5. Você abre a página inicial (host), clica em "Selecionar e Transmitir Tela" e escolhe a janela/tela a compartilhar.
6. Quem receber o link acessa `/watch/<token>` e assiste o vídeo, que é transmitido **direto do seu navegador para o dele via WebRTC** (P2P) — o servidor só ajuda a estabelecer essa conexão (signaling via Socket.IO), o vídeo não passa por ele.

## Recursos

- Escolha de **resolução** (720p, 1080p, 1440p) e **FPS** (30/60) antes de começar a transmitir.
- Suporte a **múltiplos espectadores** simultâneos (até 8).
- Lista em tempo real de quem está assistindo.
- Reconexão/aviso automático quando o host encerra a transmissão.
- Acesso protegido por token — sem o link correto, ninguém entra na sala.

## Requisitos

- [Node.js](https://nodejs.org/) instalado.
- Um executável do **[cloudflared](https://github.com/cloudflare/cloudflared/releases)** na mesma pasta do `server.js` (ou disponível no `PATH` do sistema), pois o servidor o inicia automaticamente para criar o túnel público.

## Instalação

```bash
git clone https://github.com/abiliolr/transmitir_tela.git
cd transmitir_tela
npm install
```

Baixe o `cloudflared` (executável correspondente ao seu sistema operacional) e coloque-o na raiz do projeto, ao lado do `server.js`.

## Uso

```bash
npm start
```

O terminal vai mostrar algo assim:

```
Servidor local rodando em http://localhost:8080
Iniciando Cloudflare Tunnel...
========================================================
TUNEL CRIADO E ENCURTADO COM SUCESSO!
Link para enviar aos seus amigos: https://tinyurl.com/xxxxxxx
========================================================
```

- Abra `http://localhost:8080` no seu navegador (é a tela do host) e clique em **"Selecionar e Transmitir Tela"**.
- Envie o link gerado no terminal para quem for assistir.

## Estrutura do projeto

```
.
├── server.js          # Servidor Express + Socket.IO (signaling) + automação do túnel Cloudflare
├── public/
│   ├── index.html      # Página do host
│   ├── host.js          # Captura de tela e lógica WebRTC do host
│   ├── watch.html       # Página do espectador
│   └── viewer.js         # Lógica WebRTC do espectador
├── package.json
└── package-lock.json
```

## Stack

- [Express](https://expressjs.com/) — servidor HTTP e arquivos estáticos
- [Socket.IO](https://socket.io/) — signaling do WebRTC (troca de offers, answers e ICE candidates)
- [WebRTC](https://webrtc.org/) — transmissão de vídeo/áudio P2P entre host e espectadores
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) — exposição do servidor local na internet sem configurar portas/roteador

## Limitações conhecidas

- Máximo de 8 espectadores por transmissão (limite fixo no código).
- Depende do encurtador TinyURL; se o serviço bloquear ou estiver fora do ar, o link completo é usado como alternativa.
- Não funciona em navegadores/dispositivos que não suportam `getDisplayMedia` (ex.: a maioria dos navegadores mobile).
- Projeto ainda em fase de testes — pode ter bugs e mudanças de comportamento entre commits.

## Aviso

Este projeto sobe um túnel público apontando para a sua máquina. Trate o link/token gerado como uma informação sensível e evite deixá-lo exposto publicamente.