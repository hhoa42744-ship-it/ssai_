FROM node:18-bullseye

# Cài đặt FFmpeg và các công cụ hệ thống cần thiết
RUN apt-get update && apt-get install -y ffmpeg

# Thiết lập thư mục làm việc bên trong container
WORKDIR /app

# Sao chép package.json và cài đặt thư viện
COPY package*.json ./
RUN npm install

# Sao chép toàn bộ mã nguồn còn lại của dự án
COPY . .

# Mở cổng server
EXPOSE 3000

# Lệnh khởi chạy ứng dụng
CMD ["node", "server.js"]