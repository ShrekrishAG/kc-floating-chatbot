# Production image: builds the widget, serves API + widget.js
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY widget/package.json ./widget/
RUN npm install
COPY knowledge ./knowledge
COPY server ./server
COPY widget ./widget
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
RUN npm install --omit=dev --workspace=server && npm install --omit=dev
COPY knowledge ./knowledge
COPY server ./server
COPY --from=build /app/server/public ./server/public
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "server"]
