FROM node:20-alpine

WORKDIR /app

# Cài dependencies trước để tận dụng layer cache khi chỉ sửa code
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# express-session mặc định lưu memory store — 1 container thì ổn, không chạy nhiều replica
CMD ["node", "server.js"]
