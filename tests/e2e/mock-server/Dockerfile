FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY tests/e2e/mock-server/ ./tests/e2e/mock-server/
EXPOSE 4000
CMD ["npx", "tsx", "tests/e2e/mock-server/server.ts"]
