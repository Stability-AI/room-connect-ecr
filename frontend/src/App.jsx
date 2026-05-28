import React, { useState, useCallback, useRef } from "react";
import SceneViewer from "./components/SceneViewer";
import Toolbar from "./components/Toolbar";
import VolumeList from "./components/VolumeList";
import VolumeDialog from "./components/VolumeDialog";
import ObjectDetectionPanel from "./components/ObjectDetectionPanel";
import RenderingPanel from "./components/RenderingPanel";
import { detectObjects } from "./utils/objectDetection";

export default function App() {
  const [activeTab, setActiveTab] = useState("connectivity");
  const [sceneUrl, setSceneUrl] = useState(null);
  const [sceneFilename, setSceneFilename] = useState(null);
  const [volumes, setVolumes] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [pendingVolume, setPendingVolume] = useState(null);
  const [selectedVolumeId, setSelectedVolumeId] = useState(null);
  const [editingVolumeId, setEditingVolumeId] = useState(null);
  const [wireframe, setWireframe] = useState(false);
  const [orthographic, setOrthographic] = useState(false);

  // Object detection state
  const [detectedObjects, setDetectedObjects] = useState([]);
  const [showOOBBs, setShowOOBBs] = useState(true);
  const sceneRef = useRef(null);

  const handleFileLoad = useCallback((file) => {
    if (sceneUrl && sceneUrl.startsWith("blob:")) {
      URL.revokeObjectURL(sceneUrl);
    }
    const blobUrl = URL.createObjectURL(file);
    setSceneUrl(blobUrl);
    setSceneFilename(file.name);
    setVolumes([]);
    setDetectedObjects([]);
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
  }, []);

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
            onExport={handleExportObjects}
            detectedObjects={detectedObjects}
            showOOBBs={showOOBBs}
          />
        );
      case "rendering":
        return <RenderingPanel hasScene={!!sceneUrl} sceneFilename={sceneFilename} />;
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
        wireframe={wireframe}
        onToggleWireframe={() => setWireframe((w) => !w)}
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
          wireframe={wireframe}
          orthographic={orthographic}
          onSceneReady={handleSceneReady}
          detectedObjects={activeTab === "detection" ? detectedObjects : []}
          showOOBBs={showOOBBs}
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
