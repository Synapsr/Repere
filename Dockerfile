FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY scripts/copy-pdf-worker.mjs ./scripts/copy-pdf-worker.mjs
RUN --mount=type=cache,id=repere-npm,target=/root/.npm,sharing=locked npm ci --prefer-offline

FROM dependencies AS builder
COPY . .
RUN npm run build && node scripts/build-container.mjs

# Migrations use the same source and dependency lock as the application.
FROM dependencies AS migrate
COPY drizzle ./drizzle
COPY scripts/migrate.ts ./scripts/migrate.ts
CMD ["npm", "run", "db:migrate"]

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 UPLOAD_DIR=/app/uploads
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs \
    && mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads && chmod 700 /app/uploads
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.container/migrate.mjs ./migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/.container/runtime/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.container/licenses/ ./licenses/
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --chown=nextjs:nodejs docker/app/start.mjs ./docker/app/start.mjs
COPY --chown=nextjs:nodejs LICENSE THIRD_PARTY_NOTICES.md ./
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=300s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "docker/app/start.mjs"]
