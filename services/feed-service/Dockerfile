FROM node:20-alpine
WORKDIR /app
COPY prisma ./prisma
COPY shared ./shared
COPY services/feed-service/package*.json ./
RUN npm install
RUN npx prisma generate --schema=prisma/schema.prisma
COPY services/feed-service/src ./src
EXPOSE 3005
CMD ["node", "src/index.js"]
