# Build/deploy context = raiz do monorepo (workspaces npm).
#   docker build -f services/scraper-worker/Dockerfile -t juriflow-scraper-worker .
#
# Usa a imagem oficial do Playwright: já traz Chromium + as libs de sistema
# necessárias para o modo headless (evita o problema clássico de "faltam .so"
# ao instalar Playwright numa VPS crua).
ARG PLAYWRIGHT_VERSION=1.47.2

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/collectors-core/package.json packages/collectors-core/package.json
COPY services/scraper-worker/package.json services/scraper-worker/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/scraper-worker ./services/scraper-worker

RUN npm run build --workspace @juriflow/shared-types \
  && npm run build --workspace @juriflow/domain \
  && npm run build --workspace @juriflow/collectors-core \
  && npm run build --workspace @juriflow/scraper-worker

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared-types/dist ./node_modules/@juriflow/shared-types/dist
COPY --from=build /repo/packages/shared-types/package.json ./node_modules/@juriflow/shared-types/package.json
COPY --from=build /repo/packages/domain/dist ./node_modules/@juriflow/domain/dist
COPY --from=build /repo/packages/domain/package.json ./node_modules/@juriflow/domain/package.json
COPY --from=build /repo/packages/collectors-core/dist ./node_modules/@juriflow/collectors-core/dist
COPY --from=build /repo/packages/collectors-core/package.json ./node_modules/@juriflow/collectors-core/package.json
COPY --from=build /repo/services/scraper-worker/dist ./dist
COPY --from=build /repo/services/scraper-worker/package.json ./package.json

EXPOSE 3000
CMD ["node", "dist/main.js"]
