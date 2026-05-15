FROM node:22-alpine

RUN apk --no-cache add bash

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --chown=node package.json pnpm-lock.yaml /app/

USER node
WORKDIR /app
RUN pnpm install --frozen-lockfile --prod

COPY --chown=node . /app

RUN pnpm build

EXPOSE 3000

CMD [ "node", "dist/index.js" ]
