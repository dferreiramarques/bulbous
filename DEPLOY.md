# Bulbous — Deploy no GitHub + Render.com

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

## Passo 3 — Deploy no Render.com

1. Vai a [render.com](https://render.com) → cria conta com "Sign in with GitHub"
2. Clica **"New +"** → **"Web Service"**
3. Seleciona o repositório `bulbous`
4. Preenche os campos:

| Campo | Valor |
|---|---|
| **Name** | `bulbous` |
| **Region** | Frankfurt EU |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Instance Type** | `Free` |

5. Clica **"Create Web Service"** — pronto em ~2 min

URL do jogo:
```
https://bulbous.onrender.com
```

O HTTPS é automático no Render — necessário para o PWA. ✓

---

## Passo 4 — Testar instalação PWA

**Android (Chrome):** banner aparece automaticamente em baixo do ecrã

**iPhone (Safari):** guia aparece após 2 segundos — segue os 3 passos no ecrã
*(tem de abrir no Safari, não no Chrome)*

---

## Actualizar após mudanças

```bash
git add .
git commit -m "descrição"
git push
```
Render faz redeploy automaticamente.

---

## Evitar sleep do plano grátis

O servidor adormece após 15 min de inatividade (demora ~30s a acordar).
Solução gratuita: [uptimerobot.com](https://uptimerobot.com) → New Monitor → HTTP(S) → URL do jogo → Every 5 min.
