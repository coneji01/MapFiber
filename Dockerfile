# Dockerfile — MapFiber
FROM node:20-alpine

WORKDIR /app

# Copy package files and install deps
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Expose port
EXPOSE 3010

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3010/ || exit 1

# Start
CMD ["node", "backend/server.js"]
