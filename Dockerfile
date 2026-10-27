FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js ./
COPY src ./src
COPY public ./public
# Run as the unprivileged "node" user that ships with the image
USER node
# Cloud Run injects PORT (default 8080)
EXPOSE 8080
CMD ["node", "server.js"]
