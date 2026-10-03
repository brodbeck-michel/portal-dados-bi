# Deploy na VPS (Hostinger, junto do CRM Lab)

O portal roda num projeto Compose próprio (`portal-dados-bi`), isolado do CRM
Lab: diretório, rede e volumes próprios, porta só em `127.0.0.1:8090`,
container sem root, sem capabilities, com sistema de arquivos somente leitura
e teto de 256 MB / meia CPU (`docker-compose.yml`). O Caddy que já atende o
`vitrocrm.cloud` faz o HTTPS e encaminha.

## 1. DNS (painel da Hostinger)

Registros apontando para a VPS (`2.25.227.155` / `2a02:4780:95:b2cf::1`):

| Nome | Tipo | Valor |
|---|---|---|
| `bi` | A | `2.25.227.155` |
| `*.bi` | A | `2.25.227.155` |
| `bi` | AAAA | `2a02:4780:95:b2cf::1` |
| `*.bi` | AAAA | `2a02:4780:95:b2cf::1` |

O curinga `*.bi` faz qualquer cliente novo (`<cliente>.bi.vitrocrm.cloud`)
resolver sem mexer no DNS de novo.

## 2. Código e configuração

```bash
# como root: o usuário deploy não cria nada em /opt
mkdir -p /opt/portal-dados-bi && chown deploy:deploy /opt/portal-dados-bi
# como deploy
git clone https://github.com/brodbeck-michel/portal-dados-bi.git /opt/portal-dados-bi
cd /opt/portal-dados-bi
cp .env.example .env && chmod 600 .env
```

`.env` da VPS:

```
BASE_DOMAIN=bi.vitrocrm.cloud
HTTP_PORT=127.0.0.1:8090
TRUST_PROXY=true
COOKIE_SECURE=true
SESSION_IDLE_HOURS=12
SESSION_MAX_DAYS=7
APP_VERSION=0.1.0
```

Antes de subir, confira que a 8090 está livre: `ss -tlnp | grep 8090`.

```bash
docker compose up -d --build
docker compose exec app node scripts/criar-operador.js --email <seu-email> --nome "<seu nome>"
```

## 3. Caddy — o mais separado possível do CRM

O Caddy do host é compartilhado com o CRM Lab. Para mexer o mínimo no
arquivo dele, o portal vive num arquivo próprio e o `Caddyfile` principal
ganha **uma linha só**, no mesmo padrão do `import homolog.caddyfile`:

```
# Portal de Dados BI — site em arquivo separado.
import portal-dados-bi.caddyfile
```

`/etc/caddy/portal-dados-bi.caddyfile` (dono `root:caddy`, modo 640) lista os
endereços **explicitamente** — cada cliente novo entra nesta lista e exige
`reload`:

```
bi.vitrocrm.cloud, acme.bi.vitrocrm.cloud {
	@internal path /internal/*
	respond @internal 404
	reverse_proxy 127.0.0.1:8090
	log {
		output file /var/log/caddy/portal-dados-bi.log {
			roll_size 10MiB
			roll_keep 5
		}
	}
}
```

Validar e recarregar — **sempre como usuário `caddy`** (rodado como root, o
`validate` cria o log com dono root e o reload seguinte falha):

```bash
cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%F)
sudo -u caddy caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Depois do reload, conferir o CRM antes de qualquer outra coisa:
`curl -sI https://vitrocrm.cloud | head -1`.

**Quando o portal tiver VPS própria**, dá para trocar a lista explícita por
certificado sob demanda: no bloco global, `on_demand_tls { ask
http://127.0.0.1:8090/internal/tls-ask }`, e no site `*.bi.vitrocrm.cloud`
com `tls { on_demand }`. O `/internal/tls-ask` do portal só autoriza
subdomínio de cliente cadastrado. Na VPS compartilhada isso foi evitado porque
mexe no bloco global do Caddy do CRM.

## 4. Backup diário

`crontab -e` do usuário `deploy`:

```
40 3 * * * cd /opt/portal-dados-bi && docker compose exec -T app node scripts/backup.js >> /opt/portal-dados-bi/data/backups/backup.log 2>&1
```

Os backups ficam em `/opt/portal-dados-bi/data/backups/` (14 dias).

## 5. Atualizar

```bash
cd /opt/portal-dados-bi
git fetch --tags && git checkout vX.Y.Z
# ajustar APP_VERSION no .env
docker compose up -d --build
```

As migrações do banco rodam sozinhas na subida. Antes de atualizar, rode um
backup manual.

## Conferência pós-deploy

- `curl -s https://bi.vitrocrm.cloud/health` → `{"status":"ok"}`
- `/platform` abre a tela de login do operador
- Cliente criado e incluído no `portal-dados-bi.caddyfile` →
  `https://<cliente>.bi.vitrocrm.cloud` abre o login com a marca dele
- No registro de acessos, o IP mostrado é o do visitante, não `127.0.0.1`
  (se aparecer 127.0.0.1, falta `TRUST_PROXY=true`)
