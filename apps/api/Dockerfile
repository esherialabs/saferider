FROM node:24-alpine AS deps
WORKDIR /app
COPY apps/api/package*.json ./
RUN npm ci

FROM deps AS build
COPY apps/api/tsconfig.json ./tsconfig.json
COPY apps/api/src ./src
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY apps/api/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY config/ai ./config/ai
COPY config/privacy ./config/privacy
COPY config/providers ./config/providers
COPY config/rsi ./config/rsi
COPY data/providers ./data/providers
CMD ["sh", "-c", "if [ \"$API_MODE\" = \"websocket\" ]; then npm run start:ws; else npm run start; fi"]
