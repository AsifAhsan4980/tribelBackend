FROM node:20-alpine
WORKDIR /app
COPY prisma ./prisma
COPY shared ./shared
COPY services/comment-service/package*.json ./
RUN npm install
RUN npx prisma generate --schema=prisma/schema.prisma
COPY services/comment-service/src ./src
EXPOSE 3006
CMD ["node", "src/index.js"]
