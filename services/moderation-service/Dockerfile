FROM node:20-alpine
WORKDIR /app
COPY prisma ./prisma
COPY shared ./shared
COPY services/moderation-service/package*.json ./
RUN npm install
RUN npx prisma generate --schema=prisma/schema.prisma
COPY services/moderation-service/src ./src
EXPOSE 3016
CMD ["node", "src/index.js"]
