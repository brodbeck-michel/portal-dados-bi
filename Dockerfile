# Portal de Dados BI — sem dependências npm: a imagem é só o Node + o código.
FROM node:22-alpine

ARG VERSION=dev
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/portal.sqlite \
    APP_VERSION=${VERSION}

WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
