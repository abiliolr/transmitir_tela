# Instant Local Stream (SFU Multi-Room)

Uma aplicação profissional e escalável de **transmissão de tela via navegador** utilizando a poderosa arquitetura **SFU (Selective Forwarding Unit)**.

Diferente de soluções baseadas em malhas P2P diretas (que limitam a capacidade de upload do Host para cada novo espectador), este projeto utiliza o motor **Mediasoup** no backend para receber **apenas uma cópia** do vídeo do Host e distribuir ativamente para até 20 espectadores por sala, sem custos extras de serviços em nuvem gerenciados!

O backend (Node.js + Express + Socket.io) gerencia a sinalização WebRTC de forma isolada, criando `Routers` e `Transports` dinamicamente com base no ID da sala (roomId).

## 🚀 Como funciona

1. Você acessa a página inicial e clica em **"Criar Nova Transmissão"**.
2. O servidor gera um `roomId` aleatório e redireciona você para `/host/<roomId>`.
3. Na página do Host, um link de convite é gerado automaticamente.
4. O WebRTC (através da camada SFU do Mediasoup) conecta sua mídia ao servidor backend através de uma via de Produção (`Produce`).
5. Você copia e envia o link para até 20 espectadores.
6. Os espectadores entram e se conectam ao servidor (através da camada SFU) usando uma via de Consumo (`Consume`), baixando o vídeo diretamente do backend em vez do Host.

## ⚙️ Stack e Tecnologias

- **Node.js + Express** — Servidor HTTP, roteamento dinâmico.
- **Mediasoup** — Motor C++ ultrarrápido para roteamento SFU (Multi-party video).
- **Socket.IO** — Sinalização e handshakes DTLS.
- **Tailwind CSS** — Interface UI Vanilla nativa e fluida.

## 🛠️ Como rodar o projeto localmente (ou Nuvem)

1. Tenha o [Node.js](https://nodejs.org/) instalado. **Aviso:** O Mediasoup compila C++ na instalação; se estiver no Windows, precisará do Python 3 e das ferramentas de compilação C/C++ do Visual Studio instaladas. No Linux e Mac costuma ser instantâneo.
2. Clone o repositório e instale as dependências:
   ```bash
   npm install
   ```
3. Defina as variáveis de ambiente essenciais.
4. Inicie o servidor:
   ```bash
   npm start
   ```

---

## 🔥 Variáveis de Ambiente e Firewall (.env)

Por ser uma arquitetura de servidor centralizado para o WebRTC (SFU), é **crucial** que você prepare sua rede/PaaS:

### 1. `MEDIASOUP_ANNOUNCED_IP`
Você deve definir o **IP PÚBLICO** da sua máquina (VPS / EC2) para que o WebRTC saiba para onde enviar o vídeo.
> Se você rodar localmente na sua máquina para testes, não é preciso definir nada (o servidor usará `127.0.0.1` de fallback).

### 2. Abertura de Portas (Firewall)
O Mediasoup usará as portas **2000 a 2020 (TCP e UDP)** para trafegar a mídia. Você DEVE permitir a entrada nessas portas nas regras de segurança da sua Nuvem (AWS Security Group, UFW, DigitalOcean Firewall, etc). O TCP já está forçado na aplicação para plataformas mais estritas (como Railway/Heroku).

### 3. Configuração de TURN (Opcional, mas recomendado)
Assim como a versão antiga P2P, redes altamente restritas (NAT simétrico corporativo) ainda precisam de STUN/TURN para se comunicar adequadamente com o seu servidor. Configure se achar necessário:

- `TURN_URL` = URL do seu servidor TURN
- `TURN_USERNAME` = Nome de usuário
- `TURN_CREDENTIAL` = Senha do servidor

## ⚠️ Limitações e Observações

- **Limite de Viewers:** Fixado em 20 espectadores por sala. (Pode ser facilmente alterado no `server.js`). Esse limite existe apenas para não estrangular a CPU da sua instância barata de Nuvem.
- Requer acesso a dispositivos de captura de mídia. O Host não funciona adequadamente na maioria dos navegadores de celulares Android/iOS nativos (necessita ser desktop ou Chrome).