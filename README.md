# Camino España

PWA de espanhol para brasileiros que querem morar, trabalhar e se integrar na Espanha.. 

## O que tem neste projeto

- Curso estruturado em 12 módulos e 36 lições
- Missões da vida real
- Revisão inteligente com repetição espaçada
- Biblioteca de frases úteis
- Simuladores práticos
- Diagnóstico inicial
- XP, streak e meta diária
- Pronúncia com SpeechSynthesis (quando suportado pelo navegador)
- Manifest + service worker para uso como PWA

## Estrutura

- `index.html` — shell principal do app
- `styles.css` — interface mobile premium
- `app.js` — lógica de navegação, progresso, revisão e simuladores
- `data.js` — conteúdo pedagógico do app
- `manifest.webmanifest` — configuração do PWA
- `sw.js` — service worker offline
- `assets/` — ícones e screenshots

## Como publicar de graça no GitHub Pages

1. Crie um repositório no GitHub
2. Suba todos os arquivos deste projeto na raiz
3. Vá em **Settings > Pages**
4. Em **Build and deployment**, escolha a branch principal
5. Salve e aguarde o link público
6. Abra no celular e instale na tela inicial

## Como publicar na Netlify

1. Entre na Netlify
2. Crie um novo site
3. Faça upload da pasta inteira ou conecte ao GitHub
4. Como é HTML/CSS/JS puro, não precisa build command
5. Publique e use o link gerado

## Observação

O projeto funciona sem backend. Todo progresso fica salvo no navegador via localStorage.
