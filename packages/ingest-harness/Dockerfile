FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npx tsc

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY datasets ./datasets
COPY landing ./landing
COPY viz ./viz
EXPOSE 4400
# Default: serve every dataset behind path-prefix routing. Production overrides
# CMD with --host-suffix feed402.dev so wildcard cert + Caddy host-routing kicks in.
CMD ["node", "dist/serve-all.js", "--datasets-root", "./datasets", "--port", "4400"]
