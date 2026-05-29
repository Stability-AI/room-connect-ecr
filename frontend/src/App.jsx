import React, { useState, useCallback, useRef } from "react";
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
  const [lightingBrightness, setLightingBrightness] = useState(1.5);

  // Object detection state
  const [detectedObjects, setDetectedObjects] = useState([]);
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
    setDetectedObjects(results);
    setShowOOBBs(true);
  }, []);

  const handleToggleOOBBs = useCallback(() => {
    setShowOOBBs((prev) => !prev);
  }, []);

  const handleClearObjects = useCallback(() => {
    setDetectedObjects([]);
    setShowOOBBs(false);
  }, []);

  const handleCullSelection = useCallback((threshold) => {
    setDetectedObjects((prev) => cullOverlappingOOBBs(prev, threshold));
  }, []);

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
    const newCamera = {
      id: uuidv4(),
      name: `Camera ${cameras.length + 1}`,
      position: [cam.position.x, cam.position.y, cam.position.z],
      quaternion: [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w],
      fov: BLENDER_FOV,
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

  const handleAutoPlaceCameras = useCallback((count, maximizeEntropy) => {
    if (!sceneRef.current) return;

    const result = autoPlaceCameras(
      sceneRef.current,
      count,
      detectedObjects,
      maximizeEntropy
    );

    if (result.cameras.length === 0) {
      console.warn("[AutoPlace] Could not generate any valid camera positions");
      return;
    }

    const newCameras = result.cameras.map((cam, i) => ({
      id: uuidv4(),
      name: `Auto ${cameras.length + i + 1}`,
      position: cam.position,
      quaternion: cam.quaternion,
      fov: BLENDER_FOV,
    }));

    setCameras((prev) => [...prev, ...newCameras]);
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
    </div>
  );
}
