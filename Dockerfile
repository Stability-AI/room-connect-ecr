# Multi-stage production Dockerfile
# Stage 1: Build frontend
FROM node:20-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# Stage 2: Python backend serving the built frontend
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend-build /app/frontend/dist ./static

ENV UPLOAD_DIR=/tmp/room-connect-uploads
ENV STATIC_DIR=./static

EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "app:app"]
