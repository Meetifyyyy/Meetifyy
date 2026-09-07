# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Install ALL dependencies (dev + prod) needed for the build.
#
# We intentionally install devDependencies here because:
#   • `prisma generate`  requires `prisma` (devDep)
#   • `nest build`       requires `@nestjs/cli`, TypeScript, ts-loader (devDeps)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps

# Install native build tools for packages with native bindings (e.g. bcryptjs,
# node-postgres native addons, @sentry/profiling-node).
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy dependency manifests first so this layer is cached unless they change.
COPY package.json package-lock.json ./

# Install ALL dependencies including devDependencies.
RUN npm ci

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Build the NestJS application.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate the Prisma client BEFORE compiling — the generated types are
# imported by the compiled output and TypeScript will fail without them.
RUN npx prisma generate

# Compile TypeScript → dist/
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — Production runtime image.
#
# Only compiled output and production-only node_modules land here.
# devDependencies are left behind, reducing the final image size significantly.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS prod

# dumb-init provides correct PID 1 signal forwarding (SIGTERM -> graceful
# shutdown). NestJS calls app.enableShutdownHooks(), so this is required for
# graceful draining of in-flight requests and BullMQ job completion.
#
# The fonts are for the Open Graph share card (src/share/share-card.renderer.ts).
# sharp rasterises the card's SVG with librsvg, which resolves <text> through
# fontconfig — and node:22-alpine ships with no fonts at all, so without these
# every glyph on a shared post's preview image renders as an empty box. Inter is
# the brand face the app itself is set in; Noto covers the scripts and emoji
# students actually post in, per glyph, so a card in Devanagari or with an emoji
# degrades to a different face rather than to tofu.
#
# If a share card ever renders as blank rectangles, this line is the first place
# to look.
RUN apk add --no-cache dumb-init fontconfig font-inter font-noto font-noto-emoji

WORKDIR /app

# Install ONLY production dependencies into a clean directory.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output.
COPY --from=build /app/dist ./dist

# Copy Prisma schema — required at runtime by the Prisma client to locate
# the query engine and perform schema introspection.
COPY --from=build /app/prisma ./prisma

# Re-generate the Prisma client into production node_modules so the Alpine
# runtime engine binary is present (build stage may have used a different arch).
RUN npx prisma generate

# Copy static assets (email template images, the default avatars, and the
# vector wordmark the share card composites) if present.
COPY --from=build /app/assets ./assets

# Run as the built-in non-root `node` user for security.
USER node

# The API listens on PORT (default 4000). Azure Container Apps will set PORT
# automatically when ingress is configured — the app reads it from process.env.
EXPOSE 4000

# Use dumb-init as PID 1 so SIGTERM is correctly forwarded to the Node process.
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Production start: runs the compiled NestJS application.
# Prisma migrations are NOT run here — they run as a GitHub Actions step
# before the new image is deployed.
# Generated Prisma client in node_modules/@prisma/client is copied to prod.
CMD ["node", "dist/main"]
