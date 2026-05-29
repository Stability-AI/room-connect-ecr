FROM python:3.11-slim

WORKDIR /app

# Install system dependencies required by bpy/Blender
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxi6 \
    libxxf86vm1 \
    libxfixes3 \
    libxrender1 \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxkbcommon0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

# Increased timeout for large file uploads and rendering operations
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "600", "--worker-class", "gthread", "--threads", "4", "app:app"]
