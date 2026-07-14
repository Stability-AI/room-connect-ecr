# POR: Parallel Chunk Uploads and Visible Progress Bar

## Problem

When loading a large GLB file (e.g., 700MB), the backend upload runs silently in the background with no visible feedback. The "Render Views" button stays disabled until the upload completes, which takes ~10-12 minutes for a 700MB file (70 sequential 10MB chunks at ~10s each). Users see a grayed-out button with no explanation, making the app appear broken.

Two issues:

1. **No visible progress indicator** -- The `uploadProgress` state is tracked in `App.jsx` but never passed to any component or rendered in the UI.
2. **Sequential uploads are slow** -- Chunks upload one at a time. Parallel uploads (3-5 concurrent) would reduce total time by 3-5x.

## Current Implementation

### Upload flow (`frontend/src/utils/sceneUpload.js`)

```
File loaded → split into 10MB chunks → upload sequentially (one at a time)
→ POST /api/upload-chunk (×N) → POST /api/upload-merge → sceneFileId set → button enabled
```

- `CHUNK_SIZE`: 10MB
- Upload: sequential `for` loop with `await fetch` per chunk
- Progress: callback fires after each chunk completes (`(i + 1) / totalChunks`)
- Backend: each chunk saved to `CHUNKS_DIR/<uploadId>/chunk_000000`, merged on `/api/upload-merge`

### State (`frontend/src/App.jsx`)

```javascript
const [uploadProgress, setUploadProgress] = useState(null);  // 0.0 to 1.0 during upload, null when idle/done
const [sceneFileId, setSceneFileId] = useState(null);         // set after upload-merge completes
```

`uploadProgress` is updated but never passed to `Toolbar`, `RenderingPanel`, or any other component.

## Proposed Changes

### 1. Visible upload progress bar

**Where to show it:** Below the toolbar, as a full-width thin bar visible across all tabs. This ensures the user sees upload progress regardless of which tab they're on.

**Implementation in `App.jsx`:**

Pass `uploadProgress` to a new `<UploadProgressBar>` component rendered between `<Toolbar>` and the tab content:

```jsx
{uploadProgress !== null && (
  <div className="upload-progress-bar">
    <div className="upload-progress-fill" style={{ width: `${(uploadProgress * 100).toFixed(0)}%` }} />
    <span className="upload-progress-label">
      Uploading to backend: {(uploadProgress * 100).toFixed(0)}%
    </span>
  </div>
)}
```

**Also on the Rendering tab:** Pass `uploadProgress` to `RenderingPanel` and show a message near the disabled "Render Views" button explaining why it's disabled:

```jsx
{!sceneFileId && uploadProgress !== null && (
  <div className="upload-notice">
    Uploading scene to backend ({(uploadProgress * 100).toFixed(0)}%)...
    Rendering will be available once upload completes.
  </div>
)}
{!sceneFileId && uploadProgress === null && hasScene && (
  <div className="upload-notice upload-error">
    Backend upload failed. Try reloading the scene.
  </div>
)}
```

This covers three states:
- Upload in progress: show percentage
- Upload failed: show error message
- Upload complete: button enabled, no message

### 2. Parallel chunk uploads

**Change `sceneUpload.js`** to upload multiple chunks concurrently using a concurrency pool pattern:

```javascript
export async function uploadSceneChunked(file, onProgress, { concurrency = 4 } = {}) {
  const CHUNK_SIZE = 10 * 1024 * 1024;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const uploadId = crypto.randomUUID();
  let completedChunks = 0;

  const uploadChunk = async (i) => {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const response = await fetch("/api/upload-chunk", {
      method: "POST",
      headers: {
        "X-Filename": file.name,
        "X-Chunk-Index": String(i),
        "X-Total-Chunks": String(totalChunks),
        "X-Upload-Id": uploadId,
      },
      body: chunk,
    });

    if (!response.ok) {
      throw new Error(`Chunk ${i} upload failed: ${response.status}`);
    }

    completedChunks++;
    if (onProgress) onProgress(completedChunks / totalChunks);
  };

  // Upload chunks with bounded concurrency
  const queue = Array.from({ length: totalChunks }, (_, i) => i);
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const i = queue.shift();
      if (i !== undefined) await uploadChunk(i);
    }
  });
  await Promise.all(workers);

  // Merge
  const mergeResponse = await fetch("/api/upload-merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, totalChunks, uploadId }),
  });

  if (!mergeResponse.ok) throw new Error(`Merge failed: ${mergeResponse.status}`);
  return mergeResponse.json();
}
```

**Concurrency of 4** is a good default -- enough to saturate the network without overwhelming the backend pod's single gunicorn gthread worker. The backend already handles concurrent chunk writes safely since each chunk goes to its own file (`chunk_000000`, `chunk_000001`, etc.) with no shared state.

**Expected improvement:** A 700MB file currently takes ~10-12 min. With 4x concurrency, this drops to ~2.5-3 min.

### 3. Retry logic (optional enhancement)

Add per-chunk retry for transient network failures:

```javascript
const uploadChunkWithRetry = async (i, retries = 3) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await uploadChunk(i);
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
};
```

## Files to Change

| File | Change |
|------|--------|
| `frontend/src/utils/sceneUpload.js` | Replace sequential loop with parallel worker pool |
| `frontend/src/App.jsx` | Pass `uploadProgress` to progress bar component and `RenderingPanel` |
| `frontend/src/components/RenderingPanel.jsx` | Accept `uploadProgress` prop, show upload status near render button |
| `frontend/src/App.jsx` (CSS or inline) | Add progress bar styles |

## Backend Impact

None. The backend already handles concurrent chunk writes correctly -- each chunk is written to a unique file path (`CHUNKS_DIR/<uploadId>/chunk_<index>`). The merge endpoint reads them in order by filename sort. No locking or shared state issues.

## Performance Estimates

| File size | Current (sequential) | After (4x parallel) |
|-----------|---------------------|---------------------|
| 50MB | ~50s | ~15s |
| 200MB | ~3.5 min | ~1 min |
| 500MB | ~8 min | ~2 min |
| 700MB | ~12 min | ~3 min |

## Testing

1. Load a small GLB (~50MB) -- progress bar should appear and complete quickly
2. Load a large GLB (~700MB) -- progress bar should show incremental progress, button enables after merge
3. Interrupt network mid-upload (toggle WiFi) -- retry logic should recover, or error message should appear
4. Switch tabs during upload -- progress bar should remain visible across all tabs
