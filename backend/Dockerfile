FROM --platform=linux/amd64 python:3.11-slim

WORKDIR /app

# Install system dependencies required by bpy/Blender
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxi6 \
    libxxf86vm1 \
    libxfixes3 \
    libxrender1 \
    libgl1 \
    libglx-mesa0 \
    libegl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxkbcommon0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Ensure Draco decompression library is accessible for bpy's glTF importer
RUN DRACO_LIB=$(find /usr/local/lib -name "libextern_draco.so" 2>/dev/null | head -1) && \
    if [ -n "$DRACO_LIB" ]; then \
        mkdir -p /app/4.3/python/lib/python3.11/site-packages && \
        cp "$DRACO_LIB" /app/4.3/python/lib/python3.11/site-packages/libextern_draco.so; \
    else \
        BPY_PATH=$(python -c "import bpy, os; print(os.path.dirname(bpy.__file__))") && \
        DRACO_LIB=$(find "$BPY_PATH" -name "libextern_draco.so" 2>/dev/null | head -1) && \
        if [ -n "$DRACO_LIB" ]; then \
            mkdir -p /app/4.3/python/lib/python3.11/site-packages && \
            cp "$DRACO_LIB" /app/4.3/python/lib/python3.11/site-packages/libextern_draco.so; \
        fi; \
    fi

COPY . .

EXPOSE 5000

# Increased timeout for large file uploads and rendering operations
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "600", "--worker-class", "gthread", "--threads", "4", "app:app"]
