# CLAUDE.md — Portal de Dados BI

Produto próprio (projeto pessoal), multi-cliente. Visão geral, endereços e papéis: `README.md`. Deploy: `docs/DEPLOY-VPS.md`.

## Decisões que valem para toda mudança

- **Zero dependências npm.** Node 22 nativo: `node:sqlite`, `node:crypto`
  (scrypt), `node:http`, `node:test`. Não adicionar pacote sem decisão explícita
  — o `npm install` é bloqueado pelo proxy TLS na máquina de desenvolvimento, e
  sem dependência a imagem Docker builda sem rede de pacotes.
- **Frontend sem build:** HTML + CSS + JS (módulos ES) em `public/`. Texto vindo
  do servidor entra no DOM só por `textContent` (helper `el()` em
  `public/js/ui.js`), nunca por `innerHTML`.
- **Visual:** design system "Portal BI" (claude.ai/design, projeto
  `5f8ecd33-eb08-4f1e-afd5-76547d8aa2c8`). Tokens em `public/css/app.css`; uma
  cor de marca por cliente, o resto derivado. Ícones Lucide como SVG inline
  (`icon()` em `ui.js`), sem fonte de ícones por CDN. Nome do produto nunca em
  tela de cliente. Vocabulário: "painel" para o usuário, "relatório" no admin.
- **CSP rígida** (`src/app.js`): sem script/estilo inline. Nada de `style="..."`
  em HTML nem em string; ajuste dinâmico via `element.style` em JS é permitido.
- **Isolamento entre clientes:** toda função de domínio recebe `tenantId` e
  filtra por ele; registro de outro cliente é **404**, nunca 403. Toda rota
  nova de cliente entra em `test/isolamento.test.js`.
- **O link do relatório só sai por `POST /api/portal/reports/:id/open`**, que
  confere permissão e grava `report.opened`. Nenhuma listagem devolve `url`
  para o portal (o admin vê, porque edita).
- **Sessão:** cookie sem `Domain` (preso ao host). Sessão de um cliente não
  vale em outro; a do operador não vale em cliente — o suporte entra por link
  de uso único (`support_handoffs`).
- `process.env` só é lido em `src/config.js`.
- **Registro (`audit_log`)**: eventos `dominio.acao` (lista no topo de
  `src/audit.js`). Ação nova de domínio grava evento e ganha rótulo em
  `EVENT_LABELS`. O link do relatório nunca vai para o registro.
- **Migrações:** arquivo novo `src/migrations/NNN-descricao.sql`; nunca editar
  um já aplicado.
- Tudo em pt-BR: telas, mensagens de erro, commits e documentação.

## Fora do escopo da v1 (decidido em 03/10/2026)

API do Power BI / Power Embedded / RLS, login por AD ou Microsoft, recuperação
de senha por e-mail, subpastas, player de TV. Entram só com pedido explícito.

## Rodar e testar

- `npm test` — banco em memória, não precisa parar nada.
- Local com Docker: `docker compose up -d --build` (porta em `HTTP_PORT` do `.env`;
  se a 3000 estiver ocupada, use outra, ex.: 3010).
- Portal local: `http://<cliente>.localhost:3010`; operador: `http://localhost:3010/platform`.
