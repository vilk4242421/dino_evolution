# Dino Evolution — сервер (Render: Runtime Docker, Dockerfile Path = server/Dockerfile, Build Context = корень репозитория)
FROM node:20-alpine
WORKDIR /app

# зависимости сервера (pg — для Neon Postgres, необязательная)
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev --no-audit --no-fund

# общий код игры (config/sim/rooms/ai/boss + клиент, который раздаёт сервер) и сам сервер
COPY game ./game
COPY server ./server

ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/server
CMD ["node", "server.js"]
