FROM node:20-alpine
WORKDIR /app
COPY prisma ./prisma
COPY shared ./shared
COPY services/post-service/package*.json ./
RUN npm install
RUN npx prisma generate --schema=prisma/schema.prisma
COPY services/post-service/src ./src
EXPOSE 3003
CMD ["node", "src/index.js"]
