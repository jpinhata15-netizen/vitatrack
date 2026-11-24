# VitaTrack — Configuração de Progressive Web App (PWA)

Este documento descreve a implementação do **VitaTrack** como Progressive Web App (PWA) instalável para Android e iOS, preservando integralmente a arquitetura existente (React 19, Vite 6, Express, LibSQL, JWT e Vercel) e a identidade visual da marca.

---

## 1. Arquivos Criados

- `public/manifest.webmanifest` — Manifesto Web App do VitaTrack (`display: standalone`, `orientation: portrait`, `lang: pt-BR`, `theme_color: #267058`, `background_color: #F5F1E7`, ícones `192x192`, `512x512` e `512x512` `maskable`).
- `public/favicon.svg` — Ícone vetorial da marca VitaTrack (folha minimalista em branco sobre gradiente verde `#267058`).
- `public/icons/icon-192x192.png` — Ícone PNG real 192×192 (`purpose: any`).
- `public/icons/icon-512x512.png` — Ícone PNG real 512×512 (`purpose: any`).
- `public/icons/icon-512x512-maskable.png` — Ícone PNG real 512×512 com área segura centralizada (`purpose: maskable`).
- `public/icons/apple-touch-icon.png` — Ícone PNG real 180×180 dedicado para iOS / Safari.
- `src/components/pwa/PWAManager.jsx` — Gerenciador de ciclo de vida do PWA:
  - Registro e detecção de atualizações do Service Worker (`useRegisterSW`) com confirmação do usuário.
  - Banner discreto de instalação para Android via `beforeinstallprompt`.
  - Banner e modal passo a passo para instalação no iPhone/iPad (Safari).
  - Faixa discreta de aviso quando o dispositivo está offline.
- `PWA_SETUP.md` — Esta documentação.

---

## 2. Arquivos Modificados

- `package.json` / `package-lock.json` — Adicionada a dependência de desenvolvimento `vite-plugin-pwa`.
- `vite.config.js` — Integrado o plugin `VitePWA` em conjunto com `@vitejs/plugin-react`, configurando Workbox, precache de estáticos e regra `NetworkOnly` para `/api/*`.
- `index.html` — Adicionados `<link rel="manifest">`, `theme-color`, `viewport-fit=cover`, ícones PNG/SVG e meta tags específicas para iOS (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, `apple-touch-icon`).
- `src/App.jsx` — Montado `<PWAManager />` no topo da aplicação sem alterar rotas, autenticação ou páginas existentes.
- `src/index.css` — Adicionados suporte a Safe Areas (`env(safe-area-inset-top)` e `env(safe-area-inset-bottom)`), ajustes de UX mobile nativa (`100dvh`, `overscroll-behavior-y: none`, `-webkit-tap-highlight-color: transparent`, `font-size: 16px` em inputs mobile para evitar zoom automático no iOS Safari, ajustes para `@media (display-mode: standalone)`) e estilos dos banners PWA.
- `src/components/layout/BottomNav.jsx` — Compensação de `env(safe-area-inset-bottom)` na barra inferior fixa e no menu drawer "Mais Opções".
- `src/components/layout/TopBar.jsx` — Compensação de `env(safe-area-inset-top)` no cabeçalho fixo para modo standalone no iOS.

> **Observação sobre `vercel.json`:** durante a execução, o arquivo `vercel.json` encontrava-se bloqueado por outro processo aberto no sistema. Confira na seção **8. Como publicar na Vercel** o ajuste recomendado de `routes` para garantir que `/sw.js`, `/manifest.webmanifest` e os arquivos estáticos em `dist/` sejam servidos corretamente em produção na Vercel.

---

## 3. Dependências Instaladas

- `vite-plugin-pwa` (em `devDependencies`) — Integração oficial com Vite e Workbox para geração do Service Worker (`dist/sw.js` e `dist/workbox-*.js`) e hook React `virtual:pwa-register/react`.

Nenhuma dependência de runtime do backend ou do banco de dados foi adicionada ou alterada.

---

## 4. Configurações do Manifesto

Arquivo: `public/manifest.webmanifest`

| Propriedade | Valor |
|---|---|
| `name` | `VitaTrack` |
| `short_name` | `VitaTrack` |
| `description` | `Sua evolução, todos os dias.` |
| `lang` | `pt-BR` |
| `display` | `standalone` |
| `orientation` | `portrait` |
| `theme_color` | `#267058` |
| `background_color` | `#F5F1E7` |
| `start_url` | `/` |
| `scope` | `/` |
| `icons` | `192x192` (`any`), `512x512` (`any`), `512x512` (`maskable`) |

---

## 5. Estratégia de Cache e Segurança

O Service Worker gerado pelo Workbox segue regras estritas de privacidade para dados de saúde:

1. **Precache de Shell e Estáticos (`precacheAndRoute`):**
   - Arquivos JS, CSS, HTML (`index.html`), ícones PNG/SVG, fontes locais e `manifest.webmanifest`.
   - Caches antigos são limpos automaticamente (`cleanupOutdatedCaches: true`).
2. **Fontes Google (Inter):**
   - `https://fonts.googleapis.com/*` — `StaleWhileRevalidate` (`vitatrack-google-fonts-stylesheets`).
   - `https://fonts.gstatic.com/*` — `CacheFirst` com expiração de 1 ano (`vitatrack-google-fonts-webfonts`).
3. **Rotas da API (`/api/*`) — SEM CACHE PERSISTENTE:**
   - Configurada explicitamente com estratégia **`NetworkOnly`**.
   - `navigateFallbackDenylist: [/^\/api\//]` garante que chamadas `/api/*` nunca recebam `index.html`.
   - Requisições `POST`, `PUT`, `PATCH` e `DELETE` não são cacheadas.
   - Tokens JWT, respostas de login/cadastro e registros pessoais de saúde (peso, medidas, proteínas, fotos, perfil) **nunca** são armazenados no Cache Storage.
4. **Uso Offline:**
   - Limitado ao shell da aplicação e ativos estáticos.
   - O aplicativo **não simula gravação offline** de registros de saúde; quando desconectado, exibe um aviso claro no topo informando que é necessária conexão com a internet.

---

## 6. Funcionamento do Service Worker e Atualizações

- **Modo:** `generateSW` com `registerType: 'prompt'`.
- **Detecção:** o Service Worker verifica novas versões ao carregar, ao retornar para a aba (`visibilitychange`) e periodicamente a cada 60 minutos (quando online).
- **Atualização Segura:** quando uma nova versão é detectada, o novo Service Worker entra em estado de espera (`waiting`) e o componente `PWAManager` exibe uma notificação discreta (*"Nova versão disponível"*). A ativação (`SKIP_WAITING` + recarregamento) ocorre **somente após o usuário clicar em "Atualizar"**, sem interromper preenchimentos ou operações em andamento.
- Em desenvolvimento (`npm run dev`), o Service Worker fica desabilitado (`devOptions.enabled: false`) para não interferir no Hot Module Replacement (HMR).

---

## 7. Instalação nos Dispositivos

### Android (Chrome / Edge / Samsung Internet)
1. Acesse o VitaTrack pelo navegador em HTTPS (ou `localhost` para testes locais).
2. Quando o navegador sinalizar elegibilidade de instalação (`beforeinstallprompt`), um banner discreto aparecerá na tela:
   - **Instale o VitaTrack no seu celular** — *Tenha sua evolução sempre à mão.*
3. Toque em **Instalar aplicativo** e confirme no diálogo nativo do Android.
4. O VitaTrack será adicionado à tela inicial e abrirá em modo `standalone` (tela cheia, sem barra de endereço).
5. Caso o usuário feche o banner, a preferência é respeitada (`localStorage`) e o banner não volta a aparecer; se o app já estiver instalado, também não é exibido.

### iPhone / iPad (iOS Safari)
Como o Safari no iOS não dispara o evento `beforeinstallprompt`, o VitaTrack exibe uma orientação específica para dispositivos iOS:
1. Abra o VitaTrack no **Safari**.
2. Toque no botão **Compartilhar** (ícone de quadrado com seta para cima na barra inferior).
3. Role e selecione **Adicionar à Tela de Início**.
4. Toque em **Adicionar** no canto superior direito para confirmar.

---

## 8. Como Testar Localmente

### Desenvolvimento (Frontend + Backend)
```bash
npm run dev
```
- Frontend: `http://localhost:5173` (com proxy `/api` → `http://localhost:3001`).
- Backend: `http://localhost:3001`.

### Build de Produção e Preview do PWA
```bash
npm run build
npm run preview
```
1. Abra a URL do `vite preview` (geralmente `http://localhost:4173`) no Chrome ou Edge.
2. Abra o **DevTools → Application**:
   - **Manifest:** confirme nome, cores, `display: standalone` e ícones sem erros.
   - **Service Workers:** confirme o registro ativo de `/sw.js`.
   - **Cache Storage:** navegue e autentique-se (com o backend rodando) e verifique que nenhuma rota `/api/*` aparece armazenada no Cache Storage.
3. No **DevTools → Lighthouse**, execute a auditoria de PWA / Best Practices.

---

## 9. Como Publicar na Vercel

A estrutura atual (`@vercel/node` para `server/index.js`, `@vercel/static-build` com `distDir: "dist"` e rotas `/api/*`) é totalmente compatível com o PWA no mesmo domínio em HTTPS.

**Ajuste recomendado no `vercel.json`:** como o projeto usa `routes` (Vercel v2), certifique-se de incluir `{ "handle": "filesystem" }` e cabeçalhos `no-cache` para `sw.js` e `manifest.webmanifest` **antes** do fallback `/(.*) -> /index.html`, para que o roteamento SPA não intercepte o Service Worker, o manifesto ou os ícones:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "server/index.js",
      "use": "@vercel/node"
    },
    {
      "src": "package.json",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "dist"
      }
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "server/index.js"
    },
    {
      "src": "/sw\\.js",
      "headers": {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Service-Worker-Allowed": "/"
      },
      "dest": "/sw.js"
    },
    {
      "src": "/manifest\\.webmanifest",
      "headers": {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "public, max-age=0, must-revalidate"
      },
      "dest": "/manifest.webmanifest"
    },
    {
      "handle": "filesystem"
    },
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ]
}
```

---

## 10. Limitações Conhecidas

- **iOS Safari:** não suporta `beforeinstallprompt` (a instalação precisa ser feita manualmente via *Compartilhar → Adicionar à Tela de Início* no Safari). Outros navegadores no iOS não oferecem o mesmo suporte completo de instalação PWA.
- **Modo Offline:** por segurança e privacidade de dados de saúde, consultas e salvamentos via `/api/*` requerem conexão ativa com a internet; não há fila de sincronização offline.
- **Validação em dispositivos físicos:** os testes automatizados deste ambiente validam build, geração do manifesto, ícones, Service Worker e preview HTTP local. A instalação real deve ser verificada em aparelhos Android (Chrome) e iPhone (Safari) após o deploy em HTTPS na Vercel.
- **Observação preexistente na navegação:** em `src/App.jsx`, os componentes `Sidebar` e `BottomNav` recebem a prop `activeTab`, enquanto internamente consomem `currentTab` (mantido inalterado para não realizar refatorações fora do escopo de PWA).

