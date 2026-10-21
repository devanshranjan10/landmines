# landmine-bench in a container: pinned Node and Python environments, all 66 tasks validated at build time.
#   docker build -f bench/Dockerfile -t landmine-bench .
#   docker run --rm landmine-bench npx tsx scripts/bench/validate.ts
# Agents are not included: install your agent CLI in a derived image, or run it with `--agent cmd`.
FROM node:22-bookworm
ENV UV_INSTALL_DIR=/usr/local/bin PYTHONDONTWRITEBYTECODE=1
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && uv python install 3.12
WORKDIR /bench
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && bench/setup.sh
# Fail the build unless every task still validates fail -> pass on this platform.
RUN npx tsx scripts/bench/validate.ts
