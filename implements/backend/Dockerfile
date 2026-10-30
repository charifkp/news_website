
# ─────────────────────────────────────────────
#  Dockerfile — News Project (Backend)
#  Path: news_project/backend/src/Dockerfile
# ─────────────────────────────────────────────
 
FROM node:20-alpine
 
# Set working directory inside container
WORKDIR /app
 
# Copy package files first (layer caching)
COPY package*.json ./
 
# Install dependencies
RUN npm install --omit=dev
 
# Copy backend source
# COPY . .
COPY src/ ./

# Copy frontend into the container
# COPY frontend/src/ ./frontend/src
# Copy frontend into the container 
# Copy backend source (จากโฟลเดอร์ backend/src)
COPY implements/backend/src/ ./

# Copy frontend source (จากโฟลเดอร์ frontend/src เข้ามาใน container เพื่อให้แสดงหน้าเว็บสมบูรณ์)
COPY implements/frontend/src/ ./frontend_src
 
# Expose the port the server listens on
EXPOSE 3002
 
# Start the server
CMD ["node", "index.js"]
