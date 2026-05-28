# room-connect

An interactive 3D volume connectivity editor.

room-connect lets you load, visualise, and edit connectivity graphs embedded in 3D volumetric data — architectural room layouts, cellular networks, cave systems, and more. Connectivity is represented as a directed graph whose nodes are labelled volumetric regions and whose edges encode adjacency or passage relationships.

---

## Features

- Load labelled 3D volumes from NumPy (`.npy`), NIfTI, and HDF5 formats
- Interactive 3D visualisation via PyVista (VTK)
- Python API for adding/removing nodes and edges, and merging regions
- Export edited volumes and graphs to standard formats

## Project layout

```
room-connect/
├── .cursor/rules/          # Cursor AI agent rules
├── .github/workflows/      # CI + Copilot setup steps
├── src/room_connect/       # Installable Python package
│   ├── graph.py            # Connectivity graph data model
│   ├── volume.py           # Volume I/O and processing
│   ├── editor.py           # High-level editor API
│   └── viz/renderer.py     # 3D rendering (PyVista)
├── tests/                  # pytest test suite
├── docs/                   # Documentation (MkDocs)
└── pyproject.toml
```

## Quickstart

```python
import numpy as np
from room_connect import Editor, Volume

# Create a simple labelled volume
data = np.zeros((64, 64, 64), dtype=int)
data[:32, :, :] = 1   # region 1
data[32:, :, :] = 2   # region 2

editor = Editor(Volume(data))

# Connect the two regions
editor.connect(1, 2, weight=0.8)

print(editor.summary())
```

## Installation

```bash
# Clone and install in editable mode (includes dev tools)
git clone https://github.com/Stability-AI/room-connect.git
cd room-connect
pip install -e ".[dev]"
```

## Development

| Task | Command |
|------|---------|
| Run tests | `pytest` |
| Lint | `ruff check .` |
| Format | `ruff format .` |
| Type-check | `mypy src` |

## Agent-based development with Cursor

This repository is configured for agent-based development with [Cursor](https://www.cursor.com/).
The `.cursor/rules/` directory contains rule files (`.mdc`) that provide the Cursor AI agent with persistent context about the project's architecture, tech stack, coding style, and Git workflow.

To get started, open the repository in Cursor. The agent will automatically load all rules and have full awareness of the project conventions.
