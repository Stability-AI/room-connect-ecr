import React, { useState, useCallback, useRef } from "react";
import * as THREE from "three";
import SceneViewer from "./components/SceneViewer";
import Toolbar from "./components/Toolbar";
import VolumeList from "./components/VolumeList";
import VolumeDialog from "./components/VolumeDialog";
import ObjectDetectionPanel from "./components/ObjectDetectionPanel";
import RenderingPanel from "./components/RenderingPanel";
import ScenePanel from "./components/ScenePanel";
import AnnotationsPanel from "./components/AnnotationsPanel";
import { detectObjects, cullOverlappingOOBBs, mergeOverlappingOOBBs } from "./utils/objectDetection";
import { uploadSceneChunked } from "./utils/sceneUpload";
import { v4 as uuidv4 } from "uuid";
import { BLENDER_FOV } from "./components/CameraFrustum";
import { autoPlaceCameras, mergeSceneGeometries, buildSceneBVH } from "./utils/cameraPlacement";
import { analyzeDistribution } from "./utils/cameraAnalysis";

export default function App() {
  const [activeTab, setActiveTab] = useState("scene");
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
  const [fovOverride, setFovOverride] = useState(null); // null = use default (60°)

  // Object detection state
  const [detectedObjects, setDetectedObjects] = useState([]);
  const [committedCount, setCommittedCount] = useState(0); // objects before latest detection
  const [showOOBBs, setShowOOBBs] = useState(true);
  const sceneRef = useRef(null);

  // Backend upload state
  const [sceneFileId, setSceneFileId] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);

  // Scene lights state
  const [sceneLights, setSceneLights] = useState([]);
  const [selectedLightId, setSelectedLightId] = useState(null);

  // Camera distribution analysis state
  const [analysisData, setAnalysisData] = useState(null);

  // Annotations & connections state
  const [objectAnnotations, setObjectAnnotations] = useState({});
  const [objectConnections, setObjectConnections] = useState([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [pickedMesh, setPickedMesh] = useState(null);

  // Backdrop image state
  const [backdropImage, setBackdropImage] = useState(null);

  // Persistent render state (survives tab switches)
  const [annotationRenderState, setAnnotationRenderState] = useState({
    isRendering: false, renderResult: null, renderLogs: [], showConsole: false,
  });
  const [renderingTabState, setRenderingTabState] = useState({
    isRendering: false, renderStatus: "", renderLogs: [], renderResults: null,
    showDebugConsole: false, isSplatRendering: false, splatResults: null,
    isFlyRendering: false, flyResult: null,
  });

  const handleSceneMeshPick = useCallback((meshInfo) => {
    setPickedMesh(meshInfo);
  }, []);

  const handleAddPickedToPool = useCallback((name) => {
    if (!pickedMesh) return;

    const meshObj = pickedMesh.object;
    if (meshObj && meshObj.isMesh) {
      // Rename the mesh in the Three.js scene graph
      meshObj.name = name;
      if (meshObj.parent && meshObj.parent.name === pickedMesh.name) {
        meshObj.parent.name = name;
      }

      const box = new THREE.Box3().setFromObject(meshObj);
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);

      const worldPos = meshObj.getWorldPosition(new THREE.Vector3());
      const worldScale = meshObj.getWorldScale(new THREE.Vector3());

      const newObj = {
        name: name,
        center: [center.x, center.y, center.z],
        halfExtents: [size.x / 2, size.y / 2, size.z / 2],
        rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        quaternion: [0, 0, 0, 1],
        worldPosition: [worldPos.x, worldPos.y, worldPos.z],
        worldScale: [worldScale.x, worldScale.y, worldScale.z],
      };

      setDetectedObjects((prev) => {
        if (prev.some((o) => o.name === name)) return prev;
        return [...prev, newObj];
      });
    }
    setPickedMesh(null);
  }, [pickedMesh]);

  // Camera management state
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const [activeCameraView, setActiveCameraView] = useState(null);
  const viewCameraRef = useRef(null); // ref to get current Three.js camera state

  // Hot-swap state
  const [hotSwapFile, setHotSwapFile] = useState(null);
  const [importGLBExtras, setImportGLBExtras] = useState(true);

  const loadSceneFile = useCallback((file, clearMode = "all") => {
    if (sceneUrl && sceneUrl.startsWith("blob:")) {
      URL.revokeObjectURL(sceneUrl);
    }
    const blobUrl = URL.createObjectURL(file);
    setSceneUrl(blobUrl);
    setSceneFilename(file.name);
    setSceneFileId(null);
    setUploadProgress(0);

    if (clearMode === "all") {
      setVolumes([]);
      setDetectedObjects([]);
      setCommittedCount(0);
    } else if (clearMode === "detection") {
      setDetectedObjects([]);
      setCommittedCount(0);
    }
    // "keep" mode: preserve everything

    sceneRef.current = null;

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

  const handleFileLoad = useCallback((file) => {
    if (sceneUrl) {
      setHotSwapFile(file);
    } else {
      loadSceneFile(file, "all");
    }
  }, [sceneUrl, loadSceneFile]);

  const handleHotSwapConfirm = useCallback((clearMode) => {
    if (hotSwapFile) {
      loadSceneFile(hotSwapFile, clearMode);
      setHotSwapFile(null);
    }
  }, [hotSwapFile, loadSceneFile]);

  const handleHotSwapCancel = useCallback(() => {
    setHotSwapFile(null);
  }, []);

  const handleSceneReady = useCallback((scene) => {
    sceneRef.current = scene;

    if (!importGLBExtras) return;

    const importedCameras = [];
    const importedLights = [];

    scene.traverse((child) => {
      if (child.isCamera) {
        const pos = child.getWorldPosition(new THREE.Vector3());
        const quat = child.getWorldQuaternion(new THREE.Quaternion());
        importedCameras.push({
          id: `glb-cam-${child.name || importedCameras.length}`,
          name: child.name || `GLB Camera ${importedCameras.length + 1}`,
          position: [pos.x, pos.y, pos.z],
          quaternion: [quat.x, quat.y, quat.z, quat.w],
          fov: child.fov || 60,
        });
      }

      if (child.isLight) {
        const pos = child.getWorldPosition(new THREE.Vector3());
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(child.getWorldQuaternion(new THREE.Quaternion()));
        const quat = child.getWorldQuaternion(new THREE.Quaternion());

        let lightType = "spot";
        let angle = 120;
        let sizeX = 1.0;
        let sizeY = 1.0;

        if (child.isSpotLight) {
          lightType = "spot";
          angle = child.angle ? (child.angle * 180 / Math.PI) : 120;
        } else if (child.isRectAreaLight) {
          lightType = "area";
          sizeX = child.width || 1.0;
          sizeY = child.height || 1.0;
        } else if (child.isPointLight) {
          lightType = "spot";
          angle = 170; // near-omnidirectional
        } else if (child.isDirectionalLight) {
          lightType = "area";
          sizeX = 10.0; // large area approximates parallel rays
          sizeY = 10.0;
        } else if (child.isHemisphereLight || child.isAmbientLight) {
          return; // skip ambient lights, no positional equivalent
        }

        importedLights.push({
          id: `glb-light-${child.name || importedLights.length}`,
          type: lightType,
          position: [pos.x, pos.y, pos.z],
          direction: [forward.x, forward.y, forward.z],
          quaternion: [quat.x, quat.y, quat.z, quat.w],
          intensity: child.intensity || 1000,
          exposure: 0,
          angle: angle,
          sizeX: sizeX,
          sizeY: sizeY,
        });
      }
    });

    if (importedCameras.length > 0) {
      setCameras((prev) => [...prev, ...importedCameras]);
      console.log(`[GLB Import] Imported ${importedCameras.length} cameras`);
    }
    if (importedLights.length > 0) {
      setSceneLights((prev) => [...prev, ...importedLights]);
      console.log(`[GLB Import] Imported ${importedLights.length} lights`);
    }
  }, [importGLBExtras]);

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
      const committed = prev.slice(0, committedCount);
      const newBatch = prev.slice(committedCount);
      const culled = cullOverlappingOOBBs(newBatch, threshold);
      return [...committed, ...culled];
    });
  }, [committedCount]);

  const handleMergeSelection = useCallback((threshold) => {
    setDetectedObjects((prev) => {
      const committed = prev.slice(0, committedCount);
      const newBatch = prev.slice(committedCount);
      const merged = mergeOverlappingOOBBs(newBatch, threshold);
      return [...committed, ...merged];
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
      if (cam) {
        // Spread with timestamp to force useEffect re-trigger even if same camera
        setActiveCameraView({ ...cam, _ts: Date.now() });
      }
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
    setAnalysisData(null);
  }, []);

  const handleAddLight = useCallback((lightType = "spot") => {
    if (!viewCameraRef.current) return;
    const cam = viewCameraRef.current;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    setSceneLights((prev) => [...prev, {
      id: uuidv4(),
      type: lightType,
      position: [cam.position.x, cam.position.y, cam.position.z],
      direction: [forward.x, forward.y, forward.z],
      quaternion: [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w],
      intensity: 10000,
      exposure: 0,
      angle: lightType === "spot" ? 120 : 180,
      sizeX: 1.0,
      sizeY: 1.0,
    }]);
  }, []);

  const handleUpdateLightIntensity = useCallback((lightId, intensity) => {
    setSceneLights((prev) => prev.map((l) => l.id === lightId ? { ...l, intensity } : l));
  }, []);

  const handleUpdateLightAngle = useCallback((lightId, angle) => {
    setSceneLights((prev) => prev.map((l) => l.id === lightId ? { ...l, angle } : l));
  }, []);

  const handleUpdateLightExposure = useCallback((lightId, exposure) => {
    setSceneLights((prev) => prev.map((l) => l.id === lightId ? { ...l, exposure } : l));
  }, []);

  const handleUpdateLightSize = useCallback((lightId, axis, value) => {
    setSceneLights((prev) => prev.map((l) => l.id === lightId ? { ...l, [axis]: value } : l));
  }, []);

  const handleDeleteLight = useCallback((lightId) => {
    setSceneLights((prev) => prev.filter((l) => l.id !== lightId));
  }, []);

  const handleLoadLights = useCallback((lightsData) => {
    setSceneLights(lightsData);
  }, []);

  const handleLoadCameras = useCallback((cameraDataList) => {
    const newCameras = cameraDataList.map((camData, i) => ({
      id: uuidv4(),
      name: camData.name || `Loaded ${cameras.length + i + 1}`,
      position: camData.extrinsics?.position || camData.position || [0, 0, 0],
      quaternion: camData.extrinsics?.quaternion_xyzw || camData.quaternion || [0, 0, 0, 1],
      fov: camData.intrinsics?.fov_degrees || camData.fov || 60,
    }));
    setCameras((prev) => [...prev, ...newCameras]);

    // Derive resolution and FOV from the first loaded camera
    if (cameraDataList.length > 0) {
      const first = cameraDataList[0];
      const fov = first.intrinsics?.fov_degrees || first.fov;
      if (fov) {
        setFovOverride(fov);
      }
      const pp = first.intrinsics?.principal_point;
      if (pp && pp.cx && pp.cy) {
        setRenderWidth(Math.round(pp.cx * 2));
        setRenderHeight(Math.round(pp.cy * 2));
      }
    }
  }, [cameras.length]);

  const handleRenderSelected = useCallback((cameraId) => {
    const cam = cameras.find((c) => c.id === cameraId);
    if (!cam) return;
    // Trigger a render with just this one camera by using the same render flow
    // but with a single camera array
    console.log(`[RenderSelected] Rendering from: ${cam.name}`);
  }, [cameras]);

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

    // If cameras have pre-computed quaternions (splat mode), use them directly
    // without going through OrbitControls (which would override the diverse orientations).
    const hasSplatQuaternions = params.splatMode && result.cameras.length > 0 && result.cameras[0].quaternion;

    if (hasSplatQuaternions) {
      const actualFov = viewCameraRef.current?.fov || BLENDER_FOV;
      const newCameras = result.cameras.map((genCam, index) => ({
        id: uuidv4(),
        name: `Splat ${cameras.length + index + 1}`,
        position: genCam.position,
        quaternion: genCam.quaternion,
        fov: actualFov,
      }));
      setCameras((prev) => [...prev, ...newCameras]);
      setAnalysisData(null);
      console.log(`[AutoPlace] Added ${newCameras.length} splat cameras with diverse orientations`);
    } else {
      // Standard mode: move scene camera to each position, let OrbitControls
      // process through a render frame, then capture the quaternion.
      const cam = viewCameraRef.current;
      const savedPos = cam.position.clone();
      const savedQuat = cam.quaternion.clone();

      const placeNext = (index) => {
        if (index >= result.cameras.length) {
          cam.position.copy(savedPos);
          cam.quaternion.copy(savedQuat);
          return;
        }

        const genCam = result.cameras[index];
        cam.position.set(genCam.position[0], genCam.position[1], genCam.position[2]);

        if (genCam.lookTarget) {
          cam.lookAt(genCam.lookTarget[0], genCam.lookTarget[1], genCam.lookTarget[2]);
        }

        setTimeout(() => {
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
          placeNext(index + 1);
        }, 100);
      };

      placeNext(0);
    }
  }, [cameras.length, detectedObjects]);

  const getCameraExportData = useCallback(() => {
    const aspect = renderWidth / renderHeight;

    return {
      cameras: cameras.map((cam) => {
        const effectiveFov = fovOverride || cam.fov || 60;
        const fovRad = (effectiveFov * Math.PI) / 180;
        const fy = renderHeight / (2 * Math.tan(fovRad / 2));
        const fx = fy;

        return {
        id: cam.id,
        name: cam.name,
        intrinsics: {
          fov_degrees: effectiveFov,
          fov_radians: fovRad,
          aspect_ratio: aspect,
          focal_length_px: { fx, fy },
          principal_point: { cx: renderWidth / 2, cy: renderHeight / 2 },
        },
        extrinsics: {
          position: cam.position,
          quaternion_xyzw: cam.quaternion,
        },
      };
      }),
    };
  }, [cameras, fovOverride, renderWidth, renderHeight]);

  const handleAnalyzeDistribution = useCallback(() => {
    if (!sceneRef.current || cameras.length < 3) {
      setAnalysisData(null);
      return;
    }
    setAnalysisData(null);
    requestAnimationFrame(() => {
      const mergedGeo = mergeSceneGeometries(sceneRef.current);
      if (!mergedGeo) return;
      const bvh = buildSceneBVH(mergedGeo);
      const effectiveFov = fovOverride || 60;
      const result = analyzeDistribution(cameras, bvh, mergedGeo, effectiveFov);
      mergedGeo.dispose();
      setAnalysisData(result);
    });
  }, [cameras, fovOverride]);

  const renderSidePanel = () => {
    switch (activeTab) {
      case "connectivity":
        return (
          <VolumeList
            volumes={volumes}
            selectedVolumeId={selectedVolumeId}
            onSelect={setSelectedVolumeId}
            onDelete={handleDeleteVolume}
            hasScene={!!sceneUrl}
            isDrawing={isDrawing}
            onStartDraw={handleStartDraw}
            onExport={handleExport}
          />
        );
      case "rendering":
        return (
          <RenderingPanel
            hasScene={!!sceneUrl}
            sceneFilename={sceneFilename}
            sceneFileId={sceneFileId}
            uploadProgress={uploadProgress}
            onBrightnessChange={setLightingBrightness}
            cameras={cameras}
            selectedCameraId={selectedCameraId}
            onPlaceCamera={handlePlaceCamera}
            onAutoPlaceCameras={handleAutoPlaceCameras}
            onSelectCamera={handleSelectCamera}
            onRealignCamera={handleRealignCamera}
            onDeleteCamera={handleDeleteCamera}
            onClearAllCameras={handleClearAllCameras}
            onLoadCameras={handleLoadCameras}
            onRenderSelected={handleRenderSelected}
            onAddLight={handleAddLight}
            sceneLights={sceneLights}
            onUpdateLightIntensity={handleUpdateLightIntensity}
            onUpdateLightAngle={handleUpdateLightAngle}
            onUpdateLightExposure={handleUpdateLightExposure}
            onUpdateLightSize={handleUpdateLightSize}
            onDeleteLight={handleDeleteLight}
            onLoadLights={handleLoadLights}
            selectedLightId={selectedLightId}
            onSelectLight={setSelectedLightId}
            analysisData={analysisData}
            onAnalyzeDistribution={handleAnalyzeDistribution}
            exportCameraData={getCameraExportData}
            hasDetectedObjects={detectedObjects.length > 0}
            sessionVolumes={volumes}
            sessionDetectedObjects={detectedObjects}
            renderWidth={renderWidth}
            renderHeight={renderHeight}
            onRenderSizeChange={(w, h) => { setRenderWidth(w); setRenderHeight(h); }}
            onRenderOverlaysChange={setRenderOverlays}
            onFovChange={setFovOverride}
            propFovOverride={fovOverride}
            persistedState={renderingTabState}
            onPersistedStateChange={setRenderingTabState}
            backdropImage={backdropImage}
            onBackdropChange={setBackdropImage}
          />
        );
      case "annotations":
        return (
          <AnnotationsPanel
            hasScene={!!sceneUrl}
            sceneFileId={sceneFileId}
            sceneFilename={sceneFilename}
            detectedObjects={detectedObjects}
            showOOBBs={showOOBBs}
            onDetect={handleDetectObjects}
            onToggleOOBBs={handleToggleOOBBs}
            onClearDetection={handleClearObjects}
            onCull={handleCullSelection}
            onMerge={handleMergeSelection}
            onExportObjects={handleExportObjects}
            annotations={objectAnnotations}
            onUpdateAnnotation={(name, data) => setObjectAnnotations((prev) => ({ ...prev, [name]: { ...prev[name], ...data } }))}
            connections={objectConnections}
            onAddConnection={(conn) => setObjectConnections((prev) => [...prev, conn])}
            onRemoveConnection={(idx) => setObjectConnections((prev) => prev.filter((_, i) => i !== idx))}
            selectedAnnotationId={selectedAnnotationId}
            onSelectAnnotation={setSelectedAnnotationId}
            pickedMesh={pickedMesh}
            onAddToPool={handleAddPickedToPool}
            onClearPickedMesh={() => setPickedMesh(null)}
            onRemoveFromPool={(name) => setDetectedObjects((prev) => prev.filter((o) => o.name !== name))}
            onRenameInPool={(oldName, newName) => {
              if (sceneRef.current) {
                sceneRef.current.traverse((child) => {
                  if (child.isMesh && child.name === oldName) child.name = newName;
                });
              }
              setDetectedObjects((prev) => prev.map((o) => o.name === oldName ? { ...o, name: newName } : o));
              setObjectConnections((prev) => prev.map((c) => ({
                ...c,
                source: c.source === oldName ? newName : c.source,
                target: c.target === oldName ? newName : c.target,
              })));
              setObjectAnnotations((prev) => {
                const updated = { ...prev };
                if (updated[oldName]) { updated[newName] = updated[oldName]; delete updated[oldName]; }
                return updated;
              });
              if (selectedAnnotationId === oldName) setSelectedAnnotationId(newName);
            }}
            onClearAllFromPool={() => { setDetectedObjects([]); setObjectConnections([]); }}
            renderState={annotationRenderState}
            onRenderStateChange={setAnnotationRenderState}
          />
        );
      case "scene":
        return (
          <ScenePanel
            hasScene={!!sceneUrl}
            sceneFileId={sceneFileId}
            cameras={cameras}
            sceneLights={sceneLights}
            overrideLighting={false}
            lightingBrightness={lightingBrightness}
            renderWidth={renderWidth}
            renderHeight={renderHeight}
            samples={128}
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
        importGLBExtras={importGLBExtras}
        onToggleImportExtras={() => setImportGLBExtras((v) => !v)}
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
      {uploadProgress !== null && (
        <div className="upload-progress-bar">
          <div className="upload-progress-fill" style={{ width: `${(uploadProgress * 100).toFixed(0)}%` }} />
          <span className="upload-progress-label">
            Uploading to backend: {(uploadProgress * 100).toFixed(0)}%
          </span>
        </div>
      )}
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
          detectedObjects={activeTab === "annotations" ? detectedObjects : []}
          showOOBBs={showOOBBs || activeTab === "annotations"}
          lightingBrightness={lightingBrightness}
          cameras={activeTab === "rendering" ? cameras : []}
          selectedCameraId={selectedCameraId}
          activeCameraView={activeCameraView}
          onCameraRef={(ref) => { viewCameraRef.current = ref; }}
          onSelectCamera={handleSelectCamera}
          renderWidth={renderWidth}
          renderHeight={renderHeight}
          renderOverlays={activeTab === "rendering" ? renderOverlays : null}
          fovOverride={activeTab === "rendering" ? fovOverride : null}
          sceneLights={activeTab === "rendering" ? sceneLights : []}
          selectedLightId={selectedLightId}
          onSelectLight={setSelectedLightId}
          analysisData={activeTab === "rendering" ? analysisData : null}
          objectConnections={activeTab === "annotations" ? objectConnections : []}
          connectionObjects={activeTab === "annotations" ? detectedObjects : []}
          selectedAnnotationId={activeTab === "annotations" ? selectedAnnotationId : null}
          onSelectAnnotation={activeTab === "annotations" ? setSelectedAnnotationId : undefined}
          annotationMode={activeTab === "annotations"}
          onSceneMeshPick={activeTab === "annotations" ? handleSceneMeshPick : undefined}
          pickedMeshName={activeTab === "annotations" && pickedMesh ? pickedMesh.name : null}
          backdropImage={backdropImage}
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
      {hotSwapFile && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h2>Update Scene</h2>
            <p style={{ fontSize: "0.9rem", lineHeight: 1.5 }}>
              Loading <strong>{hotSwapFile.name}</strong> will replace the current scene.
              Cameras, lights, and render settings will be preserved.
            </p>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              What should happen to volumes and detected objects?
            </p>
            <div className="dialog-actions" style={{ gap: "8px", flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => handleHotSwapConfirm("keep")}>
                Keep All
              </button>
              <button className="btn btn-accent" onClick={() => handleHotSwapConfirm("detection")}>
                Clear Detection Data
              </button>
              <button className="btn" onClick={() => handleHotSwapConfirm("all")}>
                Clear Everything
              </button>
              <button className="btn" onClick={handleHotSwapCancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
