FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV WOMBAT_PORT=8081
EXPOSE 8081

CMD ["node", "dist/server/index.js"]
