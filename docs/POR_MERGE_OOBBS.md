# POR: Merge Overlapping OOBBs

## Feature Description

In addition to the existing "Cull Selection" (which removes smaller OOBBs inside larger ones), add a "Merge Selection" option that absorbs smaller overlapping OOBBs into the larger enclosing OOBB, producing a single expanded bounding box.

## Behaviour

- User clicks "Merge Selection" button (next to "Cull Selection")
- A sensitivity dialog appears (same slider as cull, 0.0–1.0)
- For each pair of OOBBs where the smaller is inside or overlapping the larger (based on threshold):
  - The smaller OOBB is removed
  - The larger OOBB is expanded to fully enclose the union of both volumes
- The resulting merged OOBB retains the name of the larger (parent) object
- Merge only affects the latest detection batch (same protection as cull)

## Algorithm

1. Sort OOBBs by volume (largest first)
2. For each larger OOBB, check all smaller OOBBs for overlap (same containment check as cull)
3. For overlapping pairs, compute the axis-aligned bounding box that encloses both:
   - New center = midpoint of the combined min/max corners
   - New half-extents = half of the combined extent in each axis
4. Replace the larger OOBB with the merged result; remove the smaller
5. Repeat until no more merges occur (iterative)

## UI

- New button "Merge Selection" in ObjectDetectionPanel (between "Cull Selection" and "Clear OOBBs")
- Same sensitivity dialog as cull (reuse the dialog component with different title)
- Button disabled when fewer than 2 objects detected

## Implementation

### `frontend/src/utils/objectDetection.js`

Add function:
```javascript
export function mergeOverlappingOOBBs(objects, threshold = 0.5) {
  // Sort by volume (largest first)
  // Iterate: for each large OOBB, find smaller overlapping ones
  // Expand the large OOBB to enclose the smaller ones
  // Remove absorbed OOBBs
  // Repeat until stable
  return mergedObjects;
}
```

### `frontend/src/components/ObjectDetectionPanel.jsx`

- Add "Merge Selection" button
- Add state for merge dialog visibility
- Call `onMerge(threshold)` callback

### `frontend/src/App.jsx`

- Add `handleMergeSelection(threshold)` handler
- Same batch protection as cull (only merge within latest batch)
- Pass `onMerge` to ObjectDetectionPanel
