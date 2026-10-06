FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN npm prune --omit=dev

EXPOSE 3001

CMD ["sh", "-c", "rm -f /app/data/cache.db-wal /app/data/cache.db-shm 2>/dev/null; node dist/index.js"]
