FROM node:18-bullseye

# Cập nhật và cài đặt FFmpeg với cờ làm sạch cache
RUN apt-get clean && \
    apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

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