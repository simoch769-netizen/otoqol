FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY scripts ./scripts
COPY public ./public
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data
EXPOSE 3000
CMD ["node", "src/server.js"]
