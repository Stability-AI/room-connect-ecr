/**
 * Upload a large GLB file to the backend using parallel chunked streaming.
 * Chunks are uploaded concurrently (bounded by concurrency limit) for speed,
 * then merged on the server.
 *
 * @param {File} file - The GLB file to upload
 * @param {function} onProgress - Progress callback (0.0 to 1.0)
 * @param {object} [options]
 * @param {number} [options.concurrency=4] - Max parallel chunk uploads
 * @param {number} [options.retries=3] - Retries per chunk on failure
 * @returns {Promise<{id: string, filename: string, path: string}>}
 */
export async function uploadSceneChunked(file, onProgress, { concurrency = 4, retries = 3 } = {}) {
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const uploadId = crypto.randomUUID();
  let completedChunks = 0;

  const uploadChunk = async (i) => {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
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
        return;
      } catch (err) {
        if (attempt === retries - 1) throw err;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  };

  const queue = Array.from({ length: totalChunks }, (_, i) => i);
  const workers = Array.from({ length: Math.min(concurrency, totalChunks) }, async () => {
    while (queue.length > 0) {
      const i = queue.shift();
      if (i !== undefined) await uploadChunk(i);
    }
  });
  await Promise.all(workers);

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
