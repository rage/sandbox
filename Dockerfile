FROM node:24.15.0-alpine AS builder

RUN apk --no-cache add bash

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --chown=node package.json pnpm-lock.yaml pnpm-workspace.yaml /app/

USER node
WORKDIR /app
RUN pnpm install --frozen-lockfile

COPY --chown=node . /app

RUN pnpm build
RUN pnpm prune --prod --ignore-scripts

FROM node:24.15.0-alpine

RUN apk --no-cache add bash

RUN corepack enable && corepack prepare pnpm@latest --activate

USER node
WORKDIR /app

COPY --from=builder --chown=node /app/package.json /app/pnpm-lock.yaml /app/
COPY --from=builder --chown=node /app/node_modules /app/node_modules
COPY --from=builder --chown=node /app/dist /app/dist
COPY --from=builder --chown=node /app/init /app/tmc-run /app/
RUN mkdir -p /app/work

EXPOSE 3000

CMD [ "node", "dist/index.js" ]
