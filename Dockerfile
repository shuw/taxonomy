# Taxonomy for a hosted deployment (Fly.io or any container host). Bun runs the TypeScript
# directly and bundles the page on first request, so there is no separate build step.
FROM oven/bun:1.2

WORKDIR /app
COPY package.json bun.lock ./
COPY packages/engine/package.json packages/engine/
COPY packages/app/package.json packages/app/
COPY packages/mcp/package.json packages/mcp/
RUN bun install --frozen-lockfile

COPY packages packages
COPY scripts scripts
COPY data/profile.example.yaml data/demo.yaml data/

# Binding to a non-loopback address turns accounts on; the data directory is the mounted volume.
ENV HOST=0.0.0.0 \
    PORT=8080 \
    TAXONOMY_DATA=/data \
    TAXONOMY_SECURE_COOKIES=1 \
    TAXONOMY_TRUST_PROXY=1
EXPOSE 8080
VOLUME ["/data"]

# The volume arrives owned by root; hand it to the unprivileged user, then run as that user.
CMD ["sh", "-c", "chown -R bun:bun /data && exec runuser -u bun -- bun packages/app/server.ts"]
