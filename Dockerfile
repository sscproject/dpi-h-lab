# One image for API + web client (SPEC §14).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist-client ./dist-client
COPY server/migrations ./server/migrations
COPY content/content.json ./content/content.json
EXPOSE 3000
USER node
CMD ["node", "dist-server/server/main.js"]
