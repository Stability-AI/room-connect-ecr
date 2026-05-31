import React, { useState, useCallback, useRef } from "react";
import * as THREE from "three";
import SceneViewer from "./components/SceneViewer";
import Toolbar from "./components/Toolbar";
import VolumeList from "./components/VolumeList";
import VolumeDialog from "./components/VolumeDialog";
import ObjectDetectionPanel from "./components/ObjectDetectionPanel";
import RenderingPanel from "./components/RenderingPanel";
import { detectObjects, cullOverlappingOOBBs } from "./utils/objectDetection";
import { uploadSceneChunked } from "./utils/sceneUpload";
import { v4 as uuidv4 } from "uuid";
import { BLENDER_FOV } from "./components/CameraFrustum";
import { autoPlaceCameras } from "./utils/cameraPlacement";

export default function App() {
  const [activeTab, setActiveTab] = useState("connectivity");
  const [sceneUrl, setSceneUrl] = useState(null);
  const [sceneFilename, setSceneFilename] = useState(null);
  const [volumes, setVolumes] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [pendingVolume, setPendingVolume] = useState(null);
  const [selectedVolumeId, setSelectedVolumeId] = useState(null);
  const [editingVolumeId, setEditingVolumeId] = useState(null);
  const [shadingMode, setShadingMode] = useState("normals"); // normals | wireframe | diffuse | texture | shaded
  const [orthographic, setOrthographic] = useState(false);
  const [renderWidth, setRenderWidth] = useState(1920);
  const [renderHeight, setRenderHeight] = useState(1080);
  const [lightingBrightness, setLightingBrightness] = useState(1.5);

  // Render overlays (volumes + objects loaded in Rendering tab for visualization)
  const [renderOverlays, setRenderOverlays] = useState({ volumes: [], objects: [], selectedVolumeId: null });
  const [autoPlaceError, setAutoPlaceError] = useState(null);

  // Object detection state
  const [detectedObjects, setDetectedObjects] = useState([]);
  const [committedCount, setCommittedCount] = useState(0); // objects before latest detection
  const [showOOBBs, setShowOOBBs] = useState(true);
  const sceneRef = useRef(null);

  // Backend upload state
  const [sceneFileId, setSceneFileId] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);

  // Camera management state
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const [activeCameraView, setActiveCameraView] = useState(null);
  const viewCameraRef = useRef(null); // ref to get current Three.js camera state

  const handleFileLoad = useCallback((file) => {
    if (sceneUrl && sceneUrl.startsWith("blob:")) {
      URL.revokeObjectURL(sceneUrl);
    }
    const blobUrl = URL.createObjectURL(file);
    setSceneUrl(blobUrl);
    setSceneFilename(file.name);
    setVolumes([]);
    setDetectedObjects([]);
    setSceneFileId(null);
    setUploadProgress(0);

    // Upload to backend in parallel for rendering support
    uploadSceneChunked(file, (progress) => {
      setUploadProgress(progress);
    })
      .then((result) => {
        setSceneFileId(`${result.id}_${result.filename}`);
        setUploadProgress(null);
      })
      .catch((err) => {
        console.error("Backend upload failed:", err);
        setUploadProgress(null);
      });
  }, [sceneUrl]);

  const handleSceneReady = useCallback((scene) => {
    sceneRef.current = scene;
  }, []);

  const handleDetectObjects = useCallback((filterTerms, exclusive) => {
    if (!sceneRef.current) return;
    const terms = filterTerms.split(",").map((t) => t.trim()).filter(Boolean);
    const results = detectObjects(sceneRef.current, terms, exclusive);

    setDetectedObjects((prev) => {
      // Mark current list as committed before appending new results
      setCommittedCount(prev.length);

      // Filter out objects already in the committed list
      const existingKeys = new Set(
        prev.map((o) => `${o.name}_${o.center[0].toFixed(3)}_${o.center[1].toFixed(3)}_${o.center[2].toFixed(3)}`)
      );
      const newOnly = results.filter((o) => {
        const key = `${o.name}_${o.center[0].toFixed(3)}_${o.center[1].toFixed(3)}_${o.center[2].toFixed(3)}`;
        return !existingKeys.has(key);
      });
      return [...prev, ...newOnly];
    });
    setShowOOBBs(true);
  }, []);

  const handleToggleOOBBs = useCallback(() => {
    setShowOOBBs((prev) => !prev);
  }, []);

  const handleClearObjects = useCallback(() => {
    setDetectedObjects([]);
    setCommittedCount(0);
    setShowOOBBs(false);
  }, []);

  const handleCullSelection = useCallback((threshold) => {
    setDetectedObjects((prev) => {
      // Only cull within the new batch (after committedCount), leave committed objects untouched
      const committed = prev.slice(0, committedCount);
      const newBatch = prev.slice(committedCount);
      const culled = cullOverlappingOOBBs(newBatch, threshold);
      return [...committed, ...culled];
    });
  }, [committedCount]);

  const handleExportObjects = useCallback(() => {
    if (detectedObjects.length === 0) return;
    const exportData = {
      scene: sceneFilename,
      objects: detectedObjects.map((obj) => ({
        name: obj.name,
        oobb: {
          center: obj.center,
          halfExtents: obj.halfExtents,
          rotation: obj.rotation,
        },
        worldPosition: obj.worldPosition,
        worldScale: obj.worldScale,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "detected_objects.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [detectedObjects, sceneFilename]);

  const handleStartDraw = useCallback(() => {
    setIsDrawing(true);
    setSelectedVolumeId(null);
    setEditingVolumeId(null);
  }, []);

  const handleEditVolume = useCallback((id) => {
    setEditingVolumeId(id);
    setSelectedVolumeId(id);
    setIsDrawing(false);
  }, []);

  const handleEditComplete = useCallback((id, newPosition, newSize) => {
    setVolumes((prev) =>
      prev.map((v) =>
        v.id === id ? { ...v, position: newPosition, size: newSize, center: newPosition } : v
      )
    );
    setEditingVolumeId(null);
  }, []);

  const handleVolumeCreated = useCallback((volumeData) => {
    setIsDrawing(false);
    setPendingVolume(volumeData);
  }, []);

  const handleDialogConfirm = useCallback(
    (name, connections) => {
      if (!pendingVolume) return;
      const newVolume = { ...pendingVolume, name, connections };
      setVolumes((prev) => [...prev, newVolume]);
      setPendingVolume(null);
    },
    [pendingVolume]
  );

  const handleDialogCancel = useCallback(() => {
    setPendingVolume(null);
  }, []);

  const handleDeleteVolume = useCallback((id) => {
    setVolumes((prev) => {
      const filtered = prev.filter((v) => v.id !== id);
      return filtered.map((v) => ({
        ...v,
        connections: v.connections.filter((c) => c !== id),
      }));
    });
    setSelectedVolumeId(null);
  }, []);

  const handleExport = useCallback(() => {
    const graphData = {
      scene: sceneFilename,
      volumes: volumes.map((v) => ({
        id: v.id,
        name: v.name,
        center: v.center,
        size: v.size,
        position: v.position,
        connections: v.connections.map((connId) => {
          const connVol = volumes.find((x) => x.id === connId);
          return {
            id: connId,
            name: connVol ? connVol.name : "unknown",
          };
        }),
      })),
    };

    const blob = new Blob([JSON.stringify(graphData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "connectivity_graph.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [volumes, sceneFilename]);

  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    setIsDrawing(false);
    setEditingVolumeId(null);
    setActiveCameraView(null);
  }, []);

  // Camera management
  const handlePlaceCamera = useCallback(() => {
    if (!viewCameraRef.current) return;
    const cam = viewCameraRef.current;
    const q = cam.quaternion;
    const euler = new THREE.Euler().setFromQuaternion(q);
    console.log(
      `[PlaceAtView] pos=[${cam.position.x.toFixed(2)},${cam.position.y.toFixed(2)},${cam.position.z.toFixed(2)}] ` +
      `quat=[${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)},${q.w.toFixed(4)}] ` +
      `euler(deg)=[x:${(euler.x*180/Math.PI).toFixed(1)}, y:${(euler.y*180/Math.PI).toFixed(1)}, z:${(euler.z*180/Math.PI).toFixed(1)}]`
    );
    const actualFov = cam.fov || BLENDER_FOV;
    const newCamera = {
      id: uuidv4(),
      name: `Camera ${cameras.length + 1}`,
      position: [cam.position.x, cam.position.y, cam.position.z],
      quaternion: [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w],
      fov: actualFov,
    };
    setCameras((prev) => [...prev, newCamera]);
    setSelectedCameraId(newCamera.id);
  }, [cameras.length]);

  const handleSelectCamera = useCallback((id, switchView = false) => {
    setSelectedCameraId(id);
    if (switchView) {
      const cam = cameras.find((c) => c.id === id);
      if (cam) setActiveCameraView(cam);
    }
  }, [cameras]);

  const handleRealignCamera = useCallback(() => {
    if (!selectedCameraId || !viewCameraRef.current) return;
    const cam = viewCameraRef.current;
    setCameras((prev) =>
      prev.map((c) =>
        c.id === selectedCameraId
          ? {
              ...c,
              position: [cam.position.x, cam.position.y, cam.position.z],
              quaternion: [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w],
            }
          : c
      )
    );
    setActiveCameraView(null);
  }, [selectedCameraId]);

  const handleDeleteCamera = useCallback((id) => {
    setCameras((prev) => prev.filter((c) => c.id !== id));
    if (selectedCameraId === id) {
      setSelectedCameraId(null);
      setActiveCameraView(null);
    }
  }, [selectedCameraId]);

  const handleClearAllCameras = useCallback(() => {
    setCameras([]);
    setSelectedCameraId(null);
    setActiveCameraView(null);
  }, []);

  const handleAutoPlaceCameras = useCallback((count, maximizeEntropy, params = {}) => {
    if (!sceneRef.current || !viewCameraRef.current) return;

    // Use loaded objects from rendering panel if available, otherwise fall back to detection tab
    const objectsForEntropy = params.loadedObjects || detectedObjects;

    const result = autoPlaceCameras(
      sceneRef.current,
      count,
      objectsForEntropy,
      maximizeEntropy,
      params
    );

    if (result.cameras.length === 0) {
      setAutoPlaceError("Camera placement did not converge. No valid positions found — try adjusting Advanced Settings (reduce min wall distance, reduce min spacing) or select a different volume constraint.");
      return;
    }
    if (result.cameras.length < count) {
      setAutoPlaceError(`Only ${result.cameras.length} of ${count} cameras could be placed. Consider relaxing the Advanced Settings or expanding the volume constraint.`);
    }

    // Sequential placement: move the scene camera to each generated position/view,
    // then call the same logic as "Place at View" for each one.
    // Use setTimeout delays to mirror Place at View timing.
    const cam = viewCameraRef.current;
    const savedPos = cam.position.clone();
    const savedQuat = cam.quaternion.clone();

    const placeNext = (index) => {
      if (index >= result.cameras.length) {
        // Restore original camera position after all placements
        cam.position.copy(savedPos);
        cam.quaternion.copy(savedQuat);
        return;
      }

      const genCam = result.cameras[index];

      // Move scene camera to generated position
      cam.position.set(genCam.position[0], genCam.position[1], genCam.position[2]);

      // Look at generated target (same as user orbiting to look at something)
      if (genCam.lookTarget) {
        cam.lookAt(genCam.lookTarget[0], genCam.lookTarget[1], genCam.lookTarget[2]);
      }

      // Wait one frame for R3F/OrbitControls to process, then capture
      setTimeout(() => {
        // Now read back the quaternion — same as handlePlaceCamera does
        const currentCam = viewCameraRef.current;
        const actualFov = currentCam.fov || BLENDER_FOV;
        const newCamera = {
          id: uuidv4(),
          name: `Auto ${cameras.length + index + 1}`,
          position: [currentCam.position.x, currentCam.position.y, currentCam.position.z],
          quaternion: [currentCam.quaternion.x, currentCam.quaternion.y, currentCam.quaternion.z, currentCam.quaternion.w],
          fov: actualFov,
        };

        console.log(
          `[AutoPlace] ${newCamera.name}: pos=[${newCamera.position.map(v=>v.toFixed(2))}] ` +
          `quat=[${newCamera.quaternion.map(v=>v.toFixed(4))}]`
        );

        setCameras((prev) => [...prev, newCamera]);

        // Place next camera
        placeNext(index + 1);
      }, 100); // 100ms delay per camera to let the render loop process
    };

    placeNext(0);
  }, [cameras.length, detectedObjects]);

  const getCameraExportData = useCallback(() => {
    const aspect = 16 / 9;
    const fovRad = (BLENDER_FOV * Math.PI) / 180;
    const fy = renderHeight => 1080 / (2 * Math.tan(fovRad / 2));
    const fx = fy;

    return {
      cameras: cameras.map((cam) => ({
        id: cam.id,
        name: cam.name,
        intrinsics: {
          fov_degrees: cam.fov,
          fov_radians: (cam.fov * Math.PI) / 180,
          aspect_ratio: aspect,
          focal_length_px: { fx: 1080 / (2 * Math.tan(fovRad / 2)), fy: 1080 / (2 * Math.tan(fovRad / 2)) },
          principal_point: { cx: 960, cy: 540 },
        },
        extrinsics: {
          position: cam.position,
          quaternion_xyzw: cam.quaternion,
        },
      })),
    };
  }, [cameras]);

  const renderSidePanel = () => {
    switch (activeTab) {
      case "connectivity":
        return (
          <VolumeList
            volumes={volumes}
            selectedVolumeId={selectedVolumeId}
            onSelect={setSelectedVolumeId}
            onDelete={handleDeleteVolume}
          />
        );
      case "detection":
        return (
          <ObjectDetectionPanel
            hasScene={!!sceneUrl}
            sceneFilename={sceneFilename}
            onDetect={handleDetectObjects}
            onToggleOOBBs={handleToggleOOBBs}
            onClear={handleClearObjects}
            onCull={handleCullSelection}
            onExport={handleExportObjects}
            detectedObjects={detectedObjects}
            showOOBBs={showOOBBs}
          />
        );
      case "rendering":
        return (
          <RenderingPanel
            hasScene={!!sceneUrl}
            sceneFilename={sceneFilename}
            sceneFileId={sceneFileId}
            onBrightnessChange={setLightingBrightness}
            cameras={cameras}
            selectedCameraId={selectedCameraId}
            onPlaceCamera={handlePlaceCamera}
            onAutoPlaceCameras={handleAutoPlaceCameras}
            onSelectCamera={handleSelectCamera}
            onRealignCamera={handleRealignCamera}
            onDeleteCamera={handleDeleteCamera}
            onClearAllCameras={handleClearAllCameras}
            exportCameraData={getCameraExportData}
            hasDetectedObjects={detectedObjects.length > 0}
            sessionVolumes={volumes}
            sessionDetectedObjects={detectedObjects}
            renderWidth={renderWidth}
            renderHeight={renderHeight}
            onRenderSizeChange={(w, h) => { setRenderWidth(w); setRenderHeight(h); }}
            onRenderOverlaysChange={setRenderOverlays}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="app">
      <Toolbar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onFileLoad={handleFileLoad}
        onStartDraw={handleStartDraw}
        onExport={handleExport}
        isDrawing={isDrawing}
        hasScene={!!sceneUrl}
        hasVolumes={volumes.length > 0}
        shadingMode={shadingMode}
        onShadingModeChange={setShadingMode}
        orthographic={orthographic}
        onToggleOrthographic={() => setOrthographic((o) => !o)}
      />
      <div className="main-content">
        <SceneViewer
          sceneUrl={sceneUrl}
          volumes={activeTab === "connectivity" ? volumes : []}
          isDrawing={isDrawing && activeTab === "connectivity"}
          onVolumeCreated={handleVolumeCreated}
          selectedVolumeId={selectedVolumeId}
          editingVolumeId={editingVolumeId}
          onEditVolume={handleEditVolume}
          onEditComplete={handleEditComplete}
          shadingMode={shadingMode}
          orthographic={orthographic}
          onSceneReady={handleSceneReady}
          detectedObjects={activeTab === "detection" ? detectedObjects : []}
          showOOBBs={showOOBBs}
          lightingBrightness={lightingBrightness}
          cameras={activeTab === "rendering" ? cameras : []}
          selectedCameraId={selectedCameraId}
          activeCameraView={activeCameraView}
          onCameraRef={(ref) => { viewCameraRef.current = ref; }}
          onSelectCamera={handleSelectCamera}
          renderWidth={renderWidth}
          renderHeight={renderHeight}
          renderOverlays={activeTab === "rendering" ? renderOverlays : null}
        />
        {renderSidePanel()}
      </div>
      {pendingVolume && (
        <VolumeDialog
          existingVolumes={volumes}
          onConfirm={handleDialogConfirm}
          onCancel={handleDialogCancel}
        />
      )}
      {autoPlaceError && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h2>Camera Placement</h2>
            <p style={{ fontSize: "0.9rem", lineHeight: 1.5 }}>{autoPlaceError}</p>
            <div className="dialog-actions">
              <button className="btn btn-primary" onClick={() => setAutoPlaceError(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
