FROM node:20-slim AS deps
WORKDIR /app

ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --progress=false --fetch-timeout=60000 --fetch-retries=2

FROM node:20-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY . .

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SHOW_ANALYSIS_MODULES
ARG NEXT_PUBLIC_SHOW_PROMPT_DEBUG
ARG NEXT_PUBLIC_SHOW_PROMPT_LAB
ARG API_PROXY_TARGET
ARG AGENT_PROXY_TARGET
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SHOW_ANALYSIS_MODULES=$NEXT_PUBLIC_SHOW_ANALYSIS_MODULES
ENV NEXT_PUBLIC_SHOW_PROMPT_DEBUG=$NEXT_PUBLIC_SHOW_PROMPT_DEBUG
ENV NEXT_PUBLIC_SHOW_PROMPT_LAB=$NEXT_PUBLIC_SHOW_PROMPT_LAB
ENV API_PROXY_TARGET=$API_PROXY_TARGET
ENV AGENT_PROXY_TARGET=$AGENT_PROXY_TARGET
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
