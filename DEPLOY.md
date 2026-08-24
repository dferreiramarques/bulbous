# Bulbous — Deploy no GitHub + Railway

---

## Estrutura de ficheiros (completa)

```
bulbous/
├── server.js
├── game.js
├── client.html
├── package.json
├── .gitignore
└── public/
    ├── cards/
    │   └── (50 PNGs — ver IMAGES.md)
    ├── icon-192.png   ← ícone PWA 192×192px
    └── icon-512.png   ← ícone PWA 512×512px
```

> Para o banner de instalação funcionar bem, coloca um PNG 192×192 em `public/icon-192.png`
> e 512×512 em `public/icon-512.png`. Pode ser o logo do jogo. Sem ícones instala na mesma mas sem imagem.

---

## Passo 1 — Criar repositório no GitHub

1. Vai a [github.com](https://github.com) → cria conta se precisar
2. Clica **"New repository"** (botão verde no canto superior direito)
3. Nome: `bulbous`
4. Visibilidade: Public ou Private (ambos funcionam no Render free)
5. **NÃO** marques "Add a README"
6. Clica **"Create repository"**

---

## Passo 2 — Enviar ficheiros para o GitHub

Abre o Terminal (Mac) ou Git Bash (Windows) na pasta do projeto:

```bash
cd /caminho/para/bulbous

git init
git add .
git commit -m "Initial commit — Bulbous"
git branch -M main
git remote add origin https://github.com/SEU_USERNAME/bulbous.git
git push -u origin main
```

Quando pedir password, usa um **Personal Access Token**:
GitHub → Settings → Developer Settings → Personal Access Tokens → Generate new token → marca `repo`.

---

## Passo 3 — Deploy no Railway

1. Vai a [railway.com](https://railway.com) → cria conta com "Login with GitHub"
2. Clica **"New Project"**
3. Escolhe **"Deploy from GitHub repo"**
4. Seleciona o repositório `bulbous` (se pedir, autoriza o Railway a aceder aos teus repositórios)
5. O Railway deteta automaticamente que é um projeto Node.js (lê o `package.json`) e começa o deploy sozinho — não precisas de configurar Build/Start Command
6. Quando terminar (~1-2 min), clica no serviço criado → separador **"Settings"** → secção **"Networking"** → clica **"Generate Domain"**

URL do jogo (o Railway gera um domínio parecido com este):
```
https://bulbous-production.up.railway.app
```

O HTTPS é automático no Railway — necessário para o PWA. ✓

O Railway não tem o "sleep" do plano grátis do Render — o servidor fica sempre acordado, não precisas do UptimeRobot da secção abaixo (essa secção fica só como referência caso voltes a usar o Render).

---

## Passo 4 — Testar instalação PWA

**Android (Chrome):** banner aparece automaticamente em baixo do ecrã

**iPhone (Safari):** guia aparece após 2 segundos — segue os 3 passos no ecrã
*(tem de abrir no Safari, não no Chrome)*

---

## Actualizar após mudanças

**Opção simples (sem Terminal):** no GitHub, abre o repositório `bulbous`, clica **"Add file"** → **"Upload files"**, arrasta os ficheiros novos (com o mesmo nome dos antigos, ex: `game.js`) e clica **"Commit changes"**. Isto substitui o ficheiro antigo automaticamente.

**Opção com Terminal:**
```bash
git add .
git commit -m "descrição"
git push
```

Nos dois casos, o Railway deteta o novo commit e faz redeploy automaticamente (demora ~1 min).

---

## Evitar sleep do plano grátis

O servidor adormece após 15 min de inatividade (demora ~30s a acordar).
Solução gratuita: [uptimerobot.com](https://uptimerobot.com) → New Monitor → HTTP(S) → URL do jogo → Every 5 min.
