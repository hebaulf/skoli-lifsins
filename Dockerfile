# Network use during the build is limited to the `base` stage (download pnpm
# once) and the `deps` stage (pnpm install). Every later stage works offline;
# CI checks this by running the build step with networking disabled.
# (No `# syntax=` line on purpose: it would make BuildKit fetch a frontend
# image from Docker Hub on every build, another network dependency.)

# ---- 0. Node runtime: pinned by tag AND digest ----
# The digest guarantees we get exactly the image we reviewed, the tag keeps it
# readable. Dependabot opens PRs to bump it. This stage has no pnpm.
FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS node
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ---- 1. Build tooling: pnpm, downloaded exactly once ----
FROM node AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# `corepack install` downloads exactly the version in package.json
# "packageManager" into Corepack's cache, which every stage FROM base inherits.
COPY package.json ./
RUN corepack enable && corepack install
# From here on Corepack must never download anything: fail instead of fetching.
ENV COREPACK_ENABLE_NETWORK=0

# ---- 2. Install dependencies (the only network step after `base`) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- 3. Build inputs: dependencies + source (no RUN, no network) ----
# No secrets here: no ARGs, no env files (excluded by .dockerignore).
# Server secrets are read at runtime from Dokku config variables.
FROM base AS build-input
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ---- 4. Build (offline) ----
# CI runs this same script in the build-input image with --network=none.
FROM build-input AS build
RUN sh scripts/build-standalone.sh

# ---- 5. Runtime: only the standalone output, no package managers ----
# Starts from the clean `node` stage, so the pnpm download and the Corepack
# shims from `base` never reach this image.
FROM node AS runner
# Port 8080: the course Dokku server maps the app to container port 8080
# (inherited from the original nginx-unprivileged image) and students can't
# change port mappings. Keep EXPOSE, PORT and the HEALTHCHECK in sync.
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=8080

# App files are owned by root and read-only for the app user; only the Next.js
# cache directory is writable by it.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p .next/cache && chown node:node .next/cache

# The runtime only needs `node`. Remove the package managers bundled with the
# Node image (npm, npx, corepack, yarn): they're unused at runtime and carry
# their own vulnerable dependencies.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /opt/yarn-* \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/corepack \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg

# Built-in non-root user from the official Node image.
USER node

EXPOSE 8080

# Uses Node's built-in fetch, so no curl/wget is needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
