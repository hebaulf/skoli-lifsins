#!/bin/sh
# Production build used by the Dockerfile's `build` stage, and by CI to check
# that this step works with networking disabled. Must not need network access.
set -eu

# Run Next.js directly (not via pnpm/Corepack) so no package-manager logic
# can try to reach the registry.
node_modules/.bin/next build

# Next.js emits source maps for server bundles; they're not needed at runtime
# and must not ship in the image.
find .next/standalone .next/static -name '*.map' -delete
