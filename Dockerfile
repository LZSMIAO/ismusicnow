FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm check && pnpm test && pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /app/.venv \
  && /app/.venv/bin/pip install --no-cache-dir 'votify[librespot]==1.9.9' 'yt-dlp>=2026.2.4'
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/lib ./src/lib
RUN mkdir -p .data secrets && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/.data VOTIFY_BIN=/app/.venv/bin/votify YTDLP_BIN=/app/.venv/bin/yt-dlp
EXPOSE 3000
CMD ["node", "build/index.js"]
