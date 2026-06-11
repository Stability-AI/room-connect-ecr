# POR: Object Connections

**Priority**: After `POR_RENDER_FEATURES_AND_FIXES.md` is implemented.  
**Branch**: New feature branch `feat-object-connections` from main.

## Feature Description

A new panel/tab that allows users to interactively pick scene objects, define parent/child relationships between them, visualize those relationships in the 3D viewport, and export the relationship graph as JSON.

## User Flow

1. User enters Object Connections mode
2. User clicks on an object in the 3D scene to select it
3. User presses **Enter** — a dialog appears showing:
   - Selected item name
   - "Set Relationship to Items" button
4. User clicks "Set Relationship to Items" and can:
   - Click another object to select it as a related object
   - **Shift+click** to select multiple objects
5. For each selected related object, user chooses:
   - **Parent** — the related object is a parent of the initially selected object
   - **Child** — the related object is a child of the initially selected object
6. User confirms the relationship
7. User can export all relationships as JSON

## Visualization

When a user selects an object that has defined relationships:
- **Orange** transparent OOBB: the selected object itself
- **Light blue** transparent OOBB: all related child objects
- **Light green** transparent OOBB: all related parent objects

All OOBBs are computed at the time of relationship definition (using the same OOBB computation as Object Detection).

## Interaction Details

- Single click: select one object
- Shift+click: add to selection (multi-select)
- Enter: confirm selection and open relationship dialog
- Escape: cancel current selection
- Clicking an object with existing relationships highlights all associated objects automatically

## Export Format

```json
{
  "scene": "filename.glb",
  "relationships": [
    {
      "object": {
        "name": "Desk_01",
        "oobb": {
          "center": [x, y, z],
          "halfExtents": [hx, hy, hz],
          "rotation": [r00, r01, ..., r22]
        }
      },
      "parents": [
        {
          "name": "Room_A",
          "oobb": { ... }
        }
      ],
      "children": [
        {
          "name": "Monitor_01",
          "oobb": { ... }
        },
        {
          "name": "Keyboard_01",
          "oobb": { ... }
        }
      ]
    }
  ]
}
```

## Implementation Plan

### New Components
- `ObjectConnectionsPanel.jsx` — side panel with relationship list, export button
- `RelationshipDialog.jsx` — modal for setting parent/child relationships
- `ConnectionOverlay.jsx` — 3D OOBB overlays with color coding (orange/blue/green)

### State
- `relationships`: Array of `{ objectName, objectOOBB, roomVolume, parents: [], children: [] }`
- `selectionMode`: `"idle"` | `"selecting"` | `"selecting-related"`
- `currentSelection`: mesh(es) currently picked
- `multiSelect`: boolean (shift held)
- `loadedVolumes`: room volume definitions (from session or loaded JSON)

### Interaction
- Use Three.js Raycaster on click to pick meshes in the scene
- Compute OOBB for picked mesh (reuse `computeOOBB` from objectDetection.js)
- Store relationships in App state, pass to 3D overlay for visualization

### Tab Integration
- Tab order: Room Connectivity → Object Detection → **Object Connectivity** → Rendering
- Shared 3D canvas; overlays toggle per active tab

### Room Volume Assignment

Objects are automatically assigned to a room volume based on spatial containment:

- User can load a `connectivity_graph.json` (room volumes) in the Connections panel OR the Rendering panel
- If volumes are defined in the current session (Connectivity tab), they are available automatically
- For each object with a defined relationship, the system checks which volume its OOBB center falls inside
- If an object spans multiple volumes (center near boundary), it is assigned to the volume it is mostly inside of (largest overlap by volume intersection)
- Room volume assignment is included in the exported connections JSON

#### Containment check:
```
For each object:
  For each volume:
    Check if object center is inside volume AABB
    If inside multiple: compute overlap ratio, pick highest
  Assign volume with best containment (or "unassigned" if outside all)
```

### Updated Export Format

```json
{
  "scene": "filename.glb",
  "relationships": [
    {
      "object": {
        "name": "Desk_01",
        "oobb": {
          "center": [x, y, z],
          "halfExtents": [hx, hy, hz],
          "rotation": [r00, r01, ..., r22]
        },
        "roomVolume": {
          "id": "uuid",
          "name": "Office A"
        }
      },
      "parents": [
        {
          "name": "Room_A",
          "oobb": { ... },
          "roomVolume": { ... }
        }
      ],
      "children": [
        {
          "name": "Monitor_01",
          "oobb": { ... },
          "roomVolume": { ... }
        }
      ]
    }
  ]
}
```
