FROM node:24.18.0-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY . .
RUN yarn install --immutable
RUN yarn build

FROM node:24.18.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable

COPY --from=build /root/.cache/node/corepack /root/.cache/node/corepack
COPY --from=build /app /app

EXPOSE 3000

CMD ["node", "apps/server/dist/main.js"]
