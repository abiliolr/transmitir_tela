# Instant Local Stream (Multi-Room P2P)

Uma aplicação profissional e escalável de **transmissão de tela P2P via navegador**. Diferente de soluções single-room locais, essa arquitetura foi refatorada para um modelo Multi-Room na nuvem, permitindo que vários "hosts" criem salas independentes com URLs dinâmicas para compartilhamento instantâneo.

A transmissão de vídeo é feita diretamente do navegador do Host para o Viewer (Peer-to-Peer) utilizando **WebRTC**, sem passar o tráfego de vídeo pelo servidor. O backend em Express e Socket.io atua puramente como servidor de sinalização (Signaling Server) isolando a comunicação por `roomId`.

## 🚀 Como funciona

1. Você acessa a página inicial e clica em **"Criar Nova Transmissão"**.
2. O servidor gera um `roomId` aleatório e redireciona você para `/host/<roomId>`.
3. Na página do Host, um link de convite é gerado automaticamente (ex: `/watch/<roomId>`).
4. Você escolhe a qualidade, a taxa de quadros e seleciona a tela que deseja transmitir.
5. Você copia e envia o link para até 8 espectadores.
6. A conexão P2P (WebRTC) é estabelecida isoladamente dentro daquela sala!

## ⚙️ Stack e Tecnologias

- **Node.js + Express** — Servidor HTTP, roteamento dinâmico e estáticos.
- **Socket.IO** — Servidor de sinalização WebRTC isolado por Salas (Rooms).
- **WebRTC** — Transmissão de mídia de baixa latência e P2P.
- **Tailwind CSS** — Interface fluída e responsiva.

## 🛠️ Como rodar o projeto localmente

1. Tenha o [Node.js](https://nodejs.org/) instalado.
2. Clone o repositório e acesse a pasta.
3. Instale as dependências:
   ```bash
   npm install
   ```
4. Inicie o servidor:
   ```bash
   npm start
   ```
5. Acesse `http://localhost:8080` no navegador.

---

## 🌐 Configuração de STUN e TURN (Recomendado para Produção)

O protocolo WebRTC precisa de servidores STUN para descobrir os IPs públicos dos navegadores. O projeto já vem pré-configurado com os servidores STUN públicos do Google, que resolvem a maioria das conexões.

Porém, em redes corporativas ou operadoras com **NAT Simétrico** (firewalls rígidos), a conexão STUN falha e o vídeo do host não chega ao espectador (ou chega como um "slideshow"). Para resolver isso, é essencial configurar um **Servidor TURN** (que atua como um relay de vídeo nas nuvens).

### Variáveis de Ambiente (.env)

O backend do `Instant Local Stream` está preparado para injetar suas credenciais TURN através das seguintes variáveis de ambiente:

- `TURN_URL` = URL do seu servidor TURN (ex: `turn:seu-servidor.metered.live:80`)
- `TURN_USERNAME` = Nome de usuário
- `TURN_CREDENTIAL` = Senha do servidor

Basta criá-las no seu ambiente de hospedagem (Heroku, Vercel, Render, AWS, etc) ou usar um pacote como o `dotenv` localmente.

### Como criar uma conta GRATUITA no Metered Video e obter um TURN

Para facilitar os testes, recomendamos utilizar o serviço gratuito [Metered Video](https://www.metered.ca/stun-turn).

**Passo a passo:**

1. Acesse [https://www.metered.ca/stun-turn](https://www.metered.ca/stun-turn) e clique em **"Get Free TURN Server"** (ou crie sua conta).
2. Preencha seus dados de cadastro e confirme seu e-mail.
3. Ao logar no painel de controle (Dashboard), procure no menu lateral esquerdo por **"TURN Servers"** ou **"Credentials"**.
4. Você verá uma tela com os detalhes prontos para uso. O painel geralmente exibe as credenciais organizadas assim:
   - **TURN URLs** (Você terá portas 80, 443 TCP/UDP. Ex: `turn:abc.metered.live:80`)
   - **Username**
   - **Credential** (Senha)
5. Copie esses três valores e coloque nas variáveis de ambiente `TURN_URL`, `TURN_USERNAME` e `TURN_CREDENTIAL` do seu projeto.
6. Pronto! Agora qualquer espectador com rede restrita conseguirá receber a transmissão com fluidez e qualidade.

## ⚠️ Limitações e Observações

- **Limite de Viewers:** Fixado em 8 espectadores por sala para preservar o upload do host, já que é P2P (cada espectador extra multiplica a banda necessária de upload).
- Requer acesso a dispositivos de captura de mídia (Não suportado nativamente na maioria dos navegadores mobile para o perfil de Host).