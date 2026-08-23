
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
COPY . .

# Copy frontend into the container
# COPY frontend/src/ ./frontend/src
# Expose the port the server listens on
EXPOSE 3002
 
# Start the server
CMD ["node", "index.js"]
