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
# better-sqlite3 (bổ sung 18/09/2026 — lưu các cột app tự ghi, tránh lệch dòng do Don_Hang_ALL ghép từ
# công thức QUERY/VSTACK sống, xem services/trangThaiDbService.js) là native module — cần biên dịch
# TRÊN Alpine (musl, khác glibc). Cài hẳn bộ công cụ build làm ".build-deps" tạm thời rồi gỡ ngay sau
# npm ci — không phụ thuộc may rủi có sẵn bản dựng sẵn (prebuild) đúng musl/kiến trúc/phiên bản Node hay
# không (đã từng gặp đúng kiểu sự cố native-binary này với sharp — xem services/perceptualHashService.js).
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --omit=dev \
  && apk del .build-deps

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# express-session mặc định lưu memory store — 1 container thì ổn, không chạy nhiều replica
CMD ["node", "server.js"]
