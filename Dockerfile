# Imagen única: API del chat + front estático. Bun ejecuta TypeScript directamente, sin compilar.
FROM oven/bun:1-alpine

WORKDIR /app

# Dependencias primero: esta capa se reutiliza mientras no cambie el lockfile.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY agent ./agent
COPY fixtures ./fixtures
COPY src ./src
COPY web ./web
COPY demo.ts tsconfig.json ./

# El agente escribe en out/ (SAP simulado, evidencias, logs). Se ejecuta sin privilegios de root.
RUN mkdir -p out && chown -R bun:bun /app
USER bun

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- "http://localhost:${PORT}/api/health" || exit 1

CMD ["bun", "src/server.ts"]
