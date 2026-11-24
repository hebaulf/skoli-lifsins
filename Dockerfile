# syntax=docker/dockerfile:1

# Base image pinned by tag AND digest: the digest guarantees we get exactly the
# image we reviewed, the tag keeps it readable. Dependabot opens PRs to bump it.
FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

# ---- 1. Install dependencies (cached unless the lockfile changes) ----
FROM base AS deps
# Corepack installs exactly the pnpm version in package.json "packageManager".
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- 2. Build ----
# No secrets here: no ARGs, no env files (excluded by .dockerignore).
# Server secrets are read at runtime from Dokku config variables.
FROM base AS build
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js emits source maps for server bundles; they're not needed at runtime
# and must not ship in the image, so delete them right after the build.
RUN pnpm build && find .next/standalone .next/static -name '*.map' -delete

# ---- 3. Runtime: only the standalone output ----
FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# App files are owned by root and read-only for the app user; only the Next.js
# cache directory is writable by it.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p .next/cache && chown node:node .next/cache

# The runtime only needs `node`. Remove the package managers bundled with the
# base image (npm, npx, corepack, yarn): they're unused at runtime and carry
# their own vulnerable dependencies. They stay in the deps/build stages.
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

EXPOSE 3000

# Uses Node's built-in fetch, so no curl/wget is needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
