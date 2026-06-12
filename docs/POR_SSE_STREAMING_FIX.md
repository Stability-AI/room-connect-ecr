# POR: Fix SSE Render Log Streaming Stall

## Problem

When rendering multiple cameras, the frontend debug console stops receiving log updates after the first render begins. The backend completes all renders successfully, but the frontend stays stuck showing "Rendering..." with no progress updates. The render results are only available after a page refresh.

## Root Cause Analysis

### Most Likely: Vite Proxy Buffering (Issue #1)

The Vite dev server proxy (`vite.config.js`) buffers HTTP responses before forwarding to the client. SSE requires unbuffered streaming, but Vite's built-in proxy has no native SSE pass-through support.

- Backend sends incremental `event: log\ndata: ...\n\n` events
- Vite proxy buffers them in memory
- Frontend receives nothing until buffer fills or connection closes
- The `X-Accel-Buffering: no` header only works for Nginx, not Vite

### Contributing: GIL Contention (Issue #2)

Blender's `bpy.ops.render.render()` is CPU-intensive C code that may hold Python's GIL for extended periods. The SSE generator's `log_queue.get(timeout=1.0)` runs in the same process, and while it's in a separate logical flow (Flask generator), the GIL may delay queue reads.

### Contributing: Connection Timeout (Issue #3)

Long renders (10+ minutes for multiple cameras) may trigger timeouts at:
- Browser idle connection timeout
- Vite proxy request timeout
- Docker TCP keepalive settings

## Proposed Solutions (in order of preference)

### Option A: Direct Backend Connection for Render Endpoint

Bypass the Vite proxy for the `/api/render` endpoint only. Frontend makes the SSE request directly to `http://localhost:5000/api/render` instead of going through Vite.

**Pros**: Simple, no proxy changes needed, SSE works natively  
**Cons**: Requires CORS (already enabled), hardcodes port in dev

### Option B: WebSocket Instead of SSE

Replace the SSE streaming with a WebSocket connection for render progress. WebSockets have better proxy support and built-in ping/pong keepalive.

**Pros**: More reliable through proxies, bidirectional (could support cancel)  
**Cons**: More complex implementation, needs `flask-socketio` or similar

### Option C: Polling Fallback

Keep SSE as primary but add a polling fallback: if no SSE events received within 30 seconds, switch to polling `/api/render-status` every 5 seconds.

**Pros**: Works with any proxy, graceful degradation  
**Cons**: Less real-time, more complex frontend logic

### Option D: Configure Vite Proxy for Streaming

Vite uses `http-proxy` internally. It may be possible to configure it with `selfHandleResponse: false` and streaming options.

```javascript
proxy: {
  "/api/render": {
    target: "http://backend:5000",
    changeOrigin: true,
    // Attempt to disable buffering
    configure: (proxy) => {
      proxy.on('proxyRes', (proxyRes) => {
        proxyRes.headers['x-accel-buffering'] = 'no';
      });
    },
  },
}
```

**Pros**: Minimal changes  
**Cons**: May not actually work depending on Vite's internal handling

## Recommended Approach

Start with **Option A** (direct backend connection) as a quick fix, then evaluate **Option B** (WebSocket) for a production-grade solution.

## Verification Steps

1. Check browser DevTools Network tab during render — observe if bytes arrive incrementally or all at once
2. Test direct backend SSE: `curl -N http://localhost:5000/api/render` with a POST body to verify streaming works without proxy
3. After fix: confirm log lines appear in real-time in the debug console during multi-camera renders
