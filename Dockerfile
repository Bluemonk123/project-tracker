# Optional: run Project Tracker in Docker.  docker compose up -d
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4000 DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client/dist ./client/dist
COPY package.json ./
COPY server ./server
VOLUME /data
EXPOSE 4000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/start.js"]
