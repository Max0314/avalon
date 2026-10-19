FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /build
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run check && npm prune --omit=dev --no-audit --no-fund

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /build/.dist ./.dist
COPY --from=build /build/node_modules ./node_modules
COPY package.json ./package.json
COPY server ./server
COPY shared ./shared
COPY tools/backup.mjs ./tools/backup.mjs
COPY index.html manifest.json ./
COPY cards ./cards
COPY icons ./icons
COPY avatars ./avatars
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "server/index.mjs"]
