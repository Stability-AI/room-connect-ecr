# Room Connect

An interactive web-based 3D application for defining walkable area volumes and computing connectivity graphs over interior scenes.

## Overview

Room Connect lets users:

1. Load a 3D scene (`.glb` format) and explore it interactively in the browser
2. Draw axis-aligned bounding box volumes to define walkable areas
3. Name each volume and define which other volumes it connects to
4. Compute and export a connectivity graph as a JSON metadata file

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Three.js (via React Three Fiber) |
| Build | Vite |
| Backend | Python / Flask |
| Deployment | Docker / Docker Compose |

## Project Structure

```
room-connect/
├── backend/
│   ├── app.py              # Flask API server
│   ├── requirements.txt    # Python dependencies
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # Main application
│   │   ├── components/
│   │   │   ├── SceneViewer.jsx    # Three.js 3D canvas
│   │   │   ├── DrawingVolume.jsx  # Volume creation tool
│   │   │   ├── VolumeBox.jsx      # Rendered volume display
│   │   │   ├── VolumeDialog.jsx   # Name/connection dialog
│   │   │   ├── VolumeList.jsx     # Side panel list
│   │   │   └── Toolbar.jsx        # Top toolbar
│   │   └── styles/App.css
│   ├── package.json
│   ├── vite.config.js
│   └── Dockerfile
├── docker-compose.yml      # Development multi-service setup
├── Dockerfile              # Production single-container build
└── README.md
```

## Getting Started

### Development (Docker Compose)

```bash
docker-compose up
```

This starts:
- **Backend** at `http://localhost:5000`
- **Frontend** at `http://localhost:3000` (with hot reload)

### Production (single container)

```bash
docker-compose --profile prod up production
```

Or build and run directly:

```bash
docker build -t room-connect .
docker run -p 8080:8080 room-connect
```

The app is served at `http://localhost:8080`.

### Local Development (without Docker)

**Backend:**
```bash
cd backend
pip install -r requirements.txt
python app.py
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

The frontend dev server proxies `/api` requests to the backend at port 5000.

## Usage

1. Click **Load Scene (.glb)** to upload a GLTF/GLB 3D scene file
2. Explore the scene using mouse controls (orbit, pan, zoom)
3. Click **Draw Volume** to enter volume drawing mode
4. Click and drag on the ground plane to create an axis-aligned bounding box
5. Use the colored handles to scale (cube handles) and translate (sphere handles) the volume:
   - Red = X axis
   - Green = Y axis
   - Blue = Z axis
6. Press **Enter** to confirm the volume dimensions
7. In the dialog, name the volume and select which existing volumes it connects to
8. Repeat for all walkable areas
9. Click **Export Graph (JSON)** to download the connectivity graph

## Export Format

The exported JSON file contains:

```json
{
  "scene": "/api/scenes/...",
  "volumes": [
    {
      "id": "uuid-string",
      "name": "Hallway",
      "center": [x, y, z],
      "size": [width, height, depth],
      "position": [x, y, z],
      "connections": [
        { "id": "uuid-of-connected-volume", "name": "Office A" },
        { "id": "uuid-of-connected-volume", "name": "Kitchen" }
      ]
    }
  ]
}
```

Each volume has a unique UUID, a user-provided name, spatial data (center, size, position), and a list of connected volumes.
