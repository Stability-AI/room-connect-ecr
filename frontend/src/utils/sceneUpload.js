/**
 * Upload a large GLB file to the backend using chunked streaming (Option B).
 * Each chunk is sent separately to avoid memory issues with large files.
 *
 * @param {File} file - The GLB file to upload
 * @param {function} onProgress - Progress callback (0.0 to 1.0)
 * @returns {Promise<{id: string, filename: string, path: string}>}
 */
export async function uploadSceneChunked(file, onProgress) {
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const uploadId = crypto.randomUUID();

  for (let i = 0; i < totalChunks; i++) {
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
      throw new Error(`Chunk upload failed: ${response.status}`);
    }

    if (onProgress) {
      onProgress((i + 1) / totalChunks);
    }
  }

  const mergeResponse = await fetch("/api/upload-merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      totalChunks,
      uploadId,
    }),
  });

  if (!mergeResponse.ok) {
    throw new Error(`Merge failed: ${mergeResponse.status}`);
  }

  return mergeResponse.json();
}
