# Build the static frontend, then serve it (and the PMTiles + /api proxy) with
# Caddy. Two stages so the runtime image carries no Node toolchain.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM caddy:2-alpine
# Static assets; the Caddyfile and tiles/ are bind-mounted at runtime so they
# can change without rebuilding this image.
COPY --from=build /app/dist /srv
