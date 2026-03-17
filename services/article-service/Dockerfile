FROM node:20-alpine
WORKDIR /app
COPY prisma ./prisma
COPY shared ./shared
COPY services/article-service/package*.json ./
RUN npm install
RUN npx prisma generate --schema=prisma/schema.prisma
COPY services/article-service/src ./src
EXPOSE 3009
CMD ["node", "src/index.js"]
