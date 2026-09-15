FROM node:24-alpine AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=repere-npm,target=/root/.npm,sharing=locked npm ci --include=dev --ignore-scripts --prefer-offline
COPY preview ./preview
COPY shared ./shared
COPY scripts/build-preview.mjs ./scripts/build-preview.mjs
RUN npm run build:preview && \
    ./node_modules/.bin/esbuild preview/server.ts --bundle --platform=node --target=node24 --format=esm \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
      --outfile=preview/dist/server.mjs

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3001 PREVIEW_BRIDGE_PATH=/app/bridge.js
COPY --from=build --chown=node:node /app/preview/dist/server.mjs /app/server.mjs
COPY --from=build --chown=node:node /app/preview/dist/bridge.js /app/bridge.js
COPY --chown=node:node LICENSE THIRD_PARTY_NOTICES.md ./
# esbuild bundles these packages into server.mjs; retain their complete notices.
COPY --from=build --chown=node:node /app/node_modules/dotenv/LICENSE /app/licenses/dotenv.LICENSE.txt
COPY --from=build --chown=node:node /app/node_modules/parse5/LICENSE /app/licenses/parse5.LICENSE.txt
COPY --from=build --chown=node:node /app/node_modules/entities/LICENSE /app/licenses/entities.LICENSE.txt
COPY --from=build --chown=node:node /app/node_modules/ipaddr.js/LICENSE /app/licenses/ipaddr.js.LICENSE.txt
USER node
EXPOSE 3001
CMD ["node", "server.mjs"]
