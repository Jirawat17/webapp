FROM node:20-alpine

WORKDIR /app

# Chromium hệ thống cho puppeteer-core (bổ sung 04/09/2026 — lấy ảnh từ link chia sẻ Gemini, xem
# services/trangWebService.js). CỐ Ý dùng puppeteer-core + Chromium cài qua apk thay vì gói 'puppeteer'
# đầy đủ (tự tải Chromium riêng) — bản Chromium mà 'puppeteer' tự tải KHÔNG CHẠY ĐƯỢC trên Alpine
# (khác thư viện hệ thống musl/glibc). Các gói nss/freetype/harfbuzz/ttf-freefont là thư viện native
# Chromium headless cần có mới chạy được, không phải tùy chọn.
RUN apk add --no-cache chromium nss freetype freetype-dev harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Cài dependencies trước để tận dụng layer cache khi chỉ sửa code
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# express-session mặc định lưu memory store — 1 container thì ổn, không chạy nhiều replica
CMD ["node", "server.js"]
