# Diagnóstico: notificações push

Levantamento honesto do que existe hoje vs o que falta pra notificações
push funcionarem de ponta a ponta. Motivo: os toggles em `/perfil` já
existem na UI (desabilitados), mas nada por trás deles foi implementado —
esse documento evita que alguém assuma "já tem, só falta ligar".

## Busca feita

```bash
grep -rn "pushManager\|PushSubscription\|webpush\|web-push\|push_notification\|VAPID" \
  app/ components/ lib/ public/ --include="*.ts" --include="*.tsx" --include="*.js" -i
```

Zero ocorrências em qualquer uma dessas pastas.

## O que está implementado

- **Tabela `notifications`** no Supabase (`scripts/sql/001_schema.sql` +
  policy em `003_rls.sql`) — existe no schema, mas nenhum código no app
  lê ou escreve nela hoje.
- **Toggles de preferência em `/perfil`** (`app/perfil/page.tsx`, seção
  "Preferências de notificação") — são só UI: dois `<input type="checkbox"
  disabled>` com `opacity-50 cursor-not-allowed` e um `title` explicando
  "Em breve" só no hover/tooltip (pouco descobrível, sem indicação visual
  permanente).
- **`user_favorites`** já existe e já é consultado (`/perfil`, `/favoritos`)
  — é a base natural pra saber "quem monitora qual bairro", mas nenhum
  cron ainda lê essa tabela pra decidir quem notificar.
- **Service worker via `next-pwa`** (`next.config.mjs`) — gerado
  automaticamente pro cache offline do PWA (`register: true`), mas é o
  worker padrão do next-pwa: sem listener de evento `push` nem `notificationclick`.
  Adicionar isso exigiria um `swSrc` customizado (next-pwa permite injetar
  código extra no service worker gerado, mas isso não está configurado).
  Também repare que o PWA inteiro fica `disable: true` em desenvolvimento
  — só existe de fato em produção.

## O que falta

1. **Service worker com listener de `push`** — o worker atual do
   next-pwa não escuta o evento `push` nem sabe exibir uma notificação
   (`self.registration.showNotification(...)`). Precisa de um worker
   customizado (via `swSrc` do next-pwa, ou trocar a estratégia).
2. **VAPID keys** — Web Push exige um par de chaves VAPID (pública no
   cliente, privada no servidor) pra assinar as mensagens. Nenhuma chave
   foi gerada ainda; sem elas nenhuma das etapas abaixo funciona.
3. **Registro do service worker especificamente pra push** — mesmo com
   um worker escutando `push`, o navegador só entrega notificações pra
   uma `PushSubscription` ativa. Isso exige chamar
   `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC })`
   no cliente (tipicamente ao ativar o toggle em `/perfil`).
4. **Armazenamento da `PushSubscription` por usuário** — a subscription
   (endpoint + chaves `p256dh`/`auth`) precisa ser salva vinculada ao
   `user_id`, provavelmente numa tabela nova (`push_subscriptions`) já
   que `notifications` (schema atual) não tem essas colunas.
5. **Endpoint que envia a notificação** — uma rota server-side (ex:
   `/api/push/send` ou lógica dentro do próprio cron) que usa a lib
   `web-push` (não instalada ainda, ver `package.json`) com as VAPID
   keys pra montar e enviar o payload pra cada subscription.
6. **Lógica no cron pra detectar mudança de nível e disparar** — hoje
   `app/api/cron/scores/route.ts` recalcula `risk_scores` mas não compara
   com o nível anterior nem sabe quais bairros têm usuário monitorando via
   `user_favorites`. Precisaria: (a) comparar `level` novo vs armazenado,
   (b) cruzar bairros que mudaram com `user_favorites`, (c) chamar o
   endpoint de envio (item 5) pra cada usuário afetado.

## Ordem de implementação sugerida (não fizemos isso agora, só documentando)

VAPID keys → tabela `push_subscriptions` → service worker customizado →
fluxo de subscribe no toggle do `/perfil` → endpoint de envio → lógica de
detecção de mudança no cron. Cada etapa depende da anterior; não dá pra
pular pra "detectar mudança e notificar" sem ter onde entregar a notificação
primeiro.

## O que foi feito nesta revisão (não a implementação, só honestidade na UI)

- Toggles em `/perfil` ganharam badge "Em breve" visível (não só tooltip)
  e texto explicando a alternativa (instalar como PWA).
- Adicionada dica de instalação como PWA em `/perfil`, com instrução
  específica por sistema (iOS/Android) — não substitui push, mas cobre
  parcialmente o caso de uso enquanto push não existe (notificação em
  segundo plano é mais fácil de obter aceitação do usuário quando o app já
  está instalado).
