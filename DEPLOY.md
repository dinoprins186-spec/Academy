# ACADEMY ScOS v25 — PWA Deploy no Vercel
## Guia completo de produção

---

## 📁 Estrutura de ficheiros obrigatória no Vercel

```
meu-projecto/
├── api/
│   └── academy-engine.js          ← backend intacto (não mexer)
├── public/
│   ├── index.html                 ← ACADEMY-v25-PWA.html (renomear)
│   ├── manifest.json              ← ficheiro incluído neste pack
│   ├── sw.js                      ← service worker incluído neste pack
│   └── icons/
│       ├── icon-192.png           ← ícone incluído neste pack
│       ├── icon-512.png           ← ícone incluído neste pack
│       └── apple-touch-icon.png   ← ícone incluído neste pack
├── vercel.json                    ← configuração incluída neste pack
└── package.json                   ← ver abaixo
```

---

## 1. Preparar o package.json

Cria (ou actualiza) o `package.json` na raiz:

```json
{
  "name": "academy-scos",
  "version": "25.0.0",
  "type": "module",
  "engines": { "node": ">=18" }
}
```

---

## 2. Colocar os ficheiros nos sítios certos

| Ficheiro deste pack       | Destino no projecto              |
|---------------------------|----------------------------------|
| `ACADEMY-v25-PWA.html`    | `public/index.html`              |
| `manifest.json`           | `public/manifest.json`           |
| `sw.js`                   | `public/sw.js`                   |
| `icons/icon-192.png`      | `public/icons/icon-192.png`      |
| `icons/icon-512.png`      | `public/icons/icon-512.png`      |
| `icons/apple-touch-icon.png` | `public/icons/apple-touch-icon.png` |
| `vercel.json`             | `/vercel.json` (raiz do projecto) |

---

## 3. Variáveis de ambiente no Vercel

No painel Vercel → **Settings → Environment Variables**, adiciona:

| Variável                    | Valor                          | Obrigatória |
|-----------------------------|--------------------------------|-------------|
| `OPENROUTER_API_KEY`        | `sk-or-v1-xxxxxxxxxx`          | ✅ Sim       |
| `ACADEMY_URL`               | `https://teu-dominio.vercel.app` | Opcional   |
| `SUPABASE_URL`              | (pode deixar vazio ou remover) | ❌ Não       |
| `SUPABASE_SERVICE_ROLE_KEY` | (pode deixar vazio ou remover) | ❌ Não       |
| `GEMINI_API_KEY`            | (só se quiseres geração de imagens de capa) | Opcional |

---

## 4. Deploy

### Via GitHub (recomendado):
```bash
git init
git add .
git commit -m "ACADEMY PWA v25"
git remote add origin https://github.com/teu-user/academy.git
git push -u origin main
```
Depois liga o repositório no painel Vercel → **New Project**.

### Via Vercel CLI:
```bash
npm i -g vercel
vercel login
vercel --prod
```

---

## 5. Verificar se o PWA está activo

Após deploy, abre o Chrome DevTools:
1. Abre `https://teu-dominio.vercel.app`
2. **F12** → aba **Application**
3. Verifica:
   - ✅ **Service Workers** → Status: `activated and running`
   - ✅ **Manifest** → todos os campos presentes
   - ✅ **Icons** → 192x192 e 512x512 carregados

---

## 6. Instalar no Android

1. Abre a URL no Chrome
2. Após 3 segundos aparece o banner "Instalar ACADEMY"
3. Toca em **Instalar**
4. A app aparece no ecrã inicial como app nativa

## 7. Instalar no iPhone / iPad

1. Abre a URL no Safari (obrigatório — Chrome no iOS não suporta PWA install)
2. Toca no botão **Partilhar** (ícone quadrado com seta)
3. Selecciona **"Adicionar ao Ecrã de Início"**
4. Confirma

---

## 8. Push Notifications (configuração futura)

Para activar push notifications com servidor real:

### Gerar chaves VAPID:
```bash
npm install -g web-push
web-push generate-vapid-keys
```

Adiciona ao `.env`:
```
VAPID_PUBLIC_KEY=xxxxx
VAPID_PRIVATE_KEY=xxxxx
VAPID_EMAIL=mailto:teu@email.com
```

No frontend, em `pwaInit()`, adiciona:
```js
const subscription = await _pwaRegistration.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array('VAPID_PUBLIC_KEY_AQUI')
});
// Envia subscription para o teu backend
```

---

## 9. Checklist PWA Produção

- [x] manifest.json com todos os campos
- [x] Service Worker registado em scope "/"
- [x] Ícones 192x192 e 512x512
- [x] Apple Touch Icon 180x180
- [x] theme-color definido (#43E8A7)
- [x] display: standalone
- [x] Offline fallback funcional
- [x] Install prompt (Add to Home Screen)
- [x] Update banner quando nova versão disponível
- [x] Indicador de offline
- [x] Cache First para assets CDN
- [x] Network Only para API calls
- [ ] HTTPS obrigatório (Vercel garante automaticamente)
- [ ] VAPID keys para push real (configuração futura)

---

## Suporte PWA por plataforma

| Plataforma         | Instalável | Offline | Push Notifications |
|--------------------|------------|---------|-------------------|
| Android Chrome     | ✅ Sim      | ✅ Sim  | ✅ Sim             |
| Android Firefox    | ✅ Sim      | ✅ Sim  | ✅ Sim             |
| iPhone Safari      | ✅ Sim      | ✅ Sim  | ✅ iOS 16.4+       |
| Desktop Chrome     | ✅ Sim      | ✅ Sim  | ✅ Sim             |
| Desktop Edge       | ✅ Sim      | ✅ Sim  | ✅ Sim             |

---

**ACADEMY ScOS v25 — Grupo AGEA Comercial**
