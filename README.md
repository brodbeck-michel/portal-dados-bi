# Portal de Dados BI

Portal multi-cliente para acesso controlado e auditado a painéis de BI.
Cada pessoa entra com o próprio login, vê só os relatórios liberados para ela,
e cada acesso fica registrado (quem, qual relatório, quando, de qual IP).

O relatório é um **link externo** (ex.: "Publicar na Web" do Power BI). O link
fica guardado no portal e só é entregue ao navegador de quem tem permissão, no
momento em que a pessoa abre o relatório.

> **Limite conhecido, a comunicar ao cliente:** quem tem permissão para um
> relatório consegue copiar o link dele (F12 do navegador). O portal controla e
> registra o acesso, mas não impede que alguém autorizado repasse o link. Se
> vazar, gere outro link no Power BI e cole em Editar relatório — o antigo
> deixa de funcionar quando é excluído lá.

## Endereços

| Quem | Endereço | Exemplo (VPS) |
|---|---|---|
| Operador da plataforma | `BASE_DOMAIN/platform` | `https://bi.vitrocrm.cloud/platform` |
| Cliente (portal) | `<cliente>.BASE_DOMAIN` | `https://acme.bi.vitrocrm.cloud` |
| Cliente (administração) | `<cliente>.BASE_DOMAIN/#/admin/relatorios` (`/admin` redireciona) | `https://acme.bi.vitrocrm.cloud/admin` |

Localmente, `BASE_DOMAIN=localhost`: `http://localhost:3010/platform` e
`http://acme.localhost:3010` (Chrome e Firefox resolvem `*.localhost`
sozinhos).

## Marca do cliente (white label)

O nome do produto não aparece em nenhuma tela do cliente. Cada portal usa a
marca configurada pelo operador: **uma cor** (todo o resto deriva dela com
`color-mix`; marca clara como amarelo ganha texto escuro automaticamente),
título do portal (login e aba), mensagem do login, logo e ícone da aba (sem
ícone, usa a logo; sem logo, a inicial na cor da marca). Tema claro/escuro
por pessoa, salvo no navegador.

Fonte do visual: design system "Portal BI" no claude.ai/design (protótipo
e `readme.md` com as regras).

## Papéis

- **Operador da plataforma** — cria clientes, define a marca (nome, título do
  portal, mensagem do login, cor, logo, ícone da aba),
  cria o primeiro administrador e entra em qualquer cliente como **suporte**
  (link de uso único; tudo que fizer fica registrado como "Suporte: e-mail").
  Nasce por script, nunca por tela.
- **Administrador do cliente** — cadastra pessoas, pastas e relatórios, libera
  acessos e consulta o registro. Vê todos os relatórios ativos.
- **Usuário** — vê só os relatórios liberados para ele.

Regra de visibilidade: relatório ativo **e** pasta ativa **e** (administrador
**ou** liberação usuário × relatório).

## Rodar localmente

Requer só Docker (ou Node 22.13+ para rodar sem Docker). **Nenhuma dependência npm.**

```bash
cp .env.example .env            # ajuste HTTP_PORT se a 3000 estiver ocupada
docker compose up -d --build
docker compose exec app node scripts/criar-operador.js --email voce@exemplo.com --nome "Seu Nome"
```

A senha do operador aparece uma única vez. Entre em `/platform`, crie o
cliente e o primeiro administrador.

Sem Docker: `npm run dev` (porta 3000, banco em `data/portal.sqlite`).

## Testes

```bash
npm test
```

Testes com `node:test`, banco em memória. O arquivo mais importante é
`test/isolamento.test.js`: garante que um cliente não lê nem altera dado de
outro por nenhuma rota. Toda rota nova de cliente precisa entrar nele.

## Backup

```bash
docker compose exec -T app node scripts/backup.js
```

Copia o banco para `data/backups/` (funciona com o app rodando) e apaga
cópias com mais de 14 dias. Na VPS, agendar no cron — ver
`docs/DEPLOY-VPS.md`.

## Estrutura

```
server.js              sobe o HTTP e o banco
src/
  app.js               roteamento por endereço (plataforma × cliente), estáticos, CSP, erros
  config.js            único lugar que lê process.env
  db.js + migrations/  SQLite (node:sqlite) e migrações numeradas
  http.js              erros, JSON, cookies, validação, roteador
  guards.js            requireUser / requireAdmin / requireOperator
  sessions.js          sessões (hash do token no banco) e link de suporte
  login.js             senha + bloqueio após 5 erros + limite por IP
  passwords.js         scrypt, senha provisória, regra de senha
  tenants.js users.js catalog.js access.js audit.js   regras por domínio
  routes/              tenant-auth, portal, admin, platform
public/                telas em HTML/CSS/JS puro (sem build)
  index.html + js/app.js   casca do cliente: coluna lateral, Início, pastas,
                           favoritos, painel aberto e administração (js/admin.js)
  css/app.css              tokens do design system e todas as telas
  fonts/                   IBM Plex Sans auto-hospedada (OFL)
scripts/               criar-operador.js, backup.js
test/                  node:test
docs/DEPLOY-VPS.md     subir na VPS Hostinger com o Caddy
```
