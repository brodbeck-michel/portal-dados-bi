# Deploy na VPS (Hostinger, junto do CRM Lab)

O portal roda num projeto Compose próprio (`portal-dados-bi`), isolado do CRM
Lab, escutando só em `127.0.0.1:8090`. O Caddy que já atende o
`vitrocrm.cloud` faz o HTTPS e encaminha.

## 1. DNS (painel da Hostinger)

Dois registros A apontando para o IP da VPS:

| Nome | Tipo | Valor |
|---|---|---|
| `bi` | A | IP da VPS |
| `*.bi` | A | IP da VPS |

O curinga `*.bi` faz qualquer cliente novo (`<cliente>.bi.vitrocrm.cloud`)
funcionar sem mexer no DNS de novo.

## 2. Código e configuração

```bash
sudo mkdir -p /opt/portal-dados-bi && sudo chown deploy:deploy /opt/portal-dados-bi
git clone <repositorio> /opt/portal-dados-bi
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

## 3. Caddy

O certificado de cada cliente é emitido **sob demanda** na primeira visita
(`on_demand_tls`), e o Caddy pergunta ao portal se aquele subdomínio é de um
cliente cadastrado (`/internal/tls-ask`) — assim ninguém força emissão de
certificado para subdomínio inventado.

No **bloco global** do `/etc/caddy/Caddyfile` (o primeiro `{ ... }` do
arquivo; se não existir, criar no topo):

```
{
	on_demand_tls {
		ask http://127.0.0.1:8090/internal/tls-ask
	}
}
```

E o site (pode ir num arquivo importado, como o do CRM):

```
bi.vitrocrm.cloud, *.bi.vitrocrm.cloud {
	tls {
		on_demand
	}
	@internal path /internal/*
	respond @internal 404
	reverse_proxy 127.0.0.1:8090
	log {
		output file /var/log/caddy/portal-dados-bi.log
	}
}
```

Validar e recarregar — **sempre como usuário `caddy`** (rodado como root, o
`validate` cria o log com dono root e o reload seguinte falha):

```bash
sudo -u caddy caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

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
- Cliente criado → `https://<cliente>.bi.vitrocrm.cloud` abre o login com a marca dele
  (a primeira visita demora alguns segundos: é o certificado sendo emitido)
- No registro de acessos, o IP mostrado é o do visitante, não `127.0.0.1`
  (se aparecer 127.0.0.1, falta `TRUST_PROXY=true`)
