# Use lightweight Node.js LTS image
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies needed for node-gyp / sqlite if any
RUN apk add --no-cache python3 make g++

# Copy package definition files
COPY package*.json ./

# Install all dependencies (including devDependencies to build css)
RUN npm ci

# Copy source files
COPY . .

# Build CSS bundle
RUN npm run build:css

# Production image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built app and assets from builder stage
COPY --from=builder /app /app

# Ensure uploads directory exists and permissions are set
RUN mkdir -p /app/public/uploads

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
