FROM node:22-alpine AS build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/server/data
WORKDIR /app/server
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY server/package.json ./
COPY index.html /app/index.html
COPY images /app/images
COPY css /app/css
COPY js /app/js
COPY fonts /app/fonts
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
