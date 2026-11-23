FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY docker-entrypoint.sh ./
RUN chmod 755 docker-entrypoint.sh && chown -R root:root /app && chmod -R a-w /app/src /app/public
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data
EXPOSE 3000
# starts as root to fix /data volume ownership, then runs the app as the unprivileged "node" user
ENTRYPOINT ["./docker-entrypoint.sh"]
