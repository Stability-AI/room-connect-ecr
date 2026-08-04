import React, { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { v4 as uuidv4 } from "uuid";
import VolumeBox from "./VolumeBox";
import DrawingVolume from "./DrawingVolume";
import EditingVolume from "./EditingVolume";
import OOBBOverlay from "./OOBBOverlay";
import CameraFrustum from "./CameraFrustum";

const worldNormalMaterial = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  vertexShader: `
    varying vec3 vWorldNormal;
    void main() {
      vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vWorldNormal;
    void main() {
      gl_FragColor = vec4(vWorldNormal * 0.5 + 0.5, 1.0);
    }
  `,
});

const wireframeMaterial = new THREE.ShaderMaterial({
  side: THREE.FrontSide,
  wireframe: true,
  uniforms: {},
  vertexShader: `
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    void main() {
      gl_FragColor = vec4(0.53, 0.8, 1.0, 1.0);
    }
  `,
});

const diffuseMaterial = new THREE.MeshStandardMaterial({
  color: 0xcccccc,
  roughness: 0.8,
  metalness: 0.0,
  side: THREE.DoubleSide,
});

const texturUnlitMaterial = null; // placeholder — handled per-mesh below

const SceneModel = React.memo(function SceneModel({ url, shadingMode, onSceneReady }) {
  const { scene } = useGLTF(url);
  const originalMaterials = useRef(new Map());
  const hasStoredOriginals = useRef(false);
  const prevUrlRef = useRef(url);

  useEffect(() => {
    if (!hasStoredOriginals.current) {
      scene.traverse((child) => {
        if (child.isMesh && child.material) {
          originalMaterials.current.set(child.uuid, child.material);
        }
      });
      hasStoredOriginals.current = true;
    }
  }, [scene]);

  useEffect(() => {
    const currentUrl = prevUrlRef.current;
    return () => {
      scene.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((m) => {
              Object.values(m).forEach((val) => {
                if (val && typeof val.dispose === "function") val.dispose();
              });
              m.dispose();
            });
          }
        }
      });
      originalMaterials.current.clear();
      hasStoredOriginals.current = false;
      useGLTF.clear(currentUrl);
    };
  }, [url, scene]);

  useEffect(() => {
    scene.traverse((child) => {
      if (child.isMesh) {
        child.frustumCulled = true;
        switch (shadingMode) {
          case "wireframe":
            child.material = wireframeMaterial;
            break;
          case "normals":
            child.material = worldNormalMaterial;
            break;
          case "diffuse":
            child.material = diffuseMaterial;
            break;
          case "texture": {
            // Unlit albedo — show all texture maps without lighting
            const orig = originalMaterials.current.get(child.uuid);
            if (orig) {
              const unlitMat = new THREE.MeshBasicMaterial({
                side: THREE.DoubleSide,
              });
              // Copy all relevant texture properties from the original material
              if (orig.map) unlitMat.map = orig.map;
              if (orig.color) unlitMat.color = orig.color.clone();
              if (orig.alphaMap) unlitMat.alphaMap = orig.alphaMap;
              if (orig.aoMap) unlitMat.aoMap = orig.aoMap;
              if (orig.transparent) unlitMat.transparent = orig.transparent;
              if (orig.opacity !== undefined) unlitMat.opacity = orig.opacity;
              if (!orig.map && !orig.color) unlitMat.color = new THREE.Color(0xcccccc);
              child.material = unlitMat;
            }
            break;
          }
          case "shaded": {
            // Full PBR materials with studio lighting
            const orig = originalMaterials.current.get(child.uuid);
            if (orig) {
              child.material = orig;
            }
            break;
          }
        }
      }
      // Hide GLB lights from the real-time preview — we use our own studio lighting
      if (child.isLight) {
        child.visible = false;
      }
    });
  }, [scene, shadingMode]);

  useEffect(() => {
    if (onSceneReady) {
      onSceneReady(scene);
    }
  }, [scene, onSceneReady]);

  return <primitive object={scene} />;
});

function CoverageHeatmap({ scene, faceCounts }) {
  const meshRef = useRef();

  useEffect(() => {
    if (!scene || !faceCounts || faceCounts.length === 0) return;

    const geometries = [];
    const faceOffsets = [];
    let faceOffset = 0;

    scene.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const geo = child.geometry;
        const posAttr = geo.getAttribute("position");
        if (!posAttr) return;

        const cloned = new THREE.BufferGeometry();
        cloned.setAttribute("position", posAttr.clone());
        if (geo.index) cloned.setIndex(geo.index.clone());
        cloned.applyMatrix4(child.matrixWorld);

        const numFaces = geo.index ? geo.index.count / 3 : posAttr.count / 3;
        faceOffsets.push({ geo: cloned, offset: faceOffset, count: numFaces });
        faceOffset += numFaces;
        geometries.push(cloned);
      }
    });

    if (geometries.length === 0) return;

    try {
      const merged = mergeGeometries(geometries, false);
      if (!merged) return;

      const posAttr = merged.getAttribute("position");
      const vertexCount = posAttr.count;
      const colors = new Float32Array(vertexCount * 3);

      const idx = merged.index;
      const totalMergedFaces = idx ? idx.count / 3 : vertexCount / 3;

      for (let fi = 0; fi < totalMergedFaces; fi++) {
        const count = fi < faceCounts.length ? faceCounts[fi] : 0;
        let r, g, b, a;
        if (count === 0) { r = 0.4; g = 0.1; b = 0.1; }
        else if (count <= 2) { r = 1; g = 0.5; b = 0.1; }
        else if (count <= 5) { r = 1; g = 1; b = 0.2; }
        else if (count <= 10) { r = 0.2; g = 0.8; b = 0.3; }
        else { r = 0.2; g = 0.4; b = 1; }

        if (idx) {
          for (let v = 0; v < 3; v++) {
            const vi = idx.getX(fi * 3 + v);
            colors[vi * 3] = r;
            colors[vi * 3 + 1] = g;
            colors[vi * 3 + 2] = b;
          }
        } else {
          for (let v = 0; v < 3; v++) {
            const vi = fi * 3 + v;
            colors[vi * 3] = r;
            colors[vi * 3 + 1] = g;
            colors[vi * 3 + 2] = b;
          }
        }
      }

      merged.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      if (meshRef.current) {
        meshRef.current.geometry.dispose();
        meshRef.current.geometry = merged;
      }
    } catch (e) {
      console.warn("[CoverageHeatmap] Failed to build heatmap:", e);
    }

    return () => {
      geometries.forEach((g) => g.dispose());
    };
  }, [scene, faceCounts]);

  return (
    <mesh ref={meshRef} renderOrder={2}>
      <bufferGeometry />
      <meshBasicMaterial vertexColors transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function StudioLighting({ brightness }) {
  const m = brightness || 1.0;
  return (
    <>
      <ambientLight intensity={0.5 * m} color={0xffffff} />
      <hemisphereLight
        args={[0xddeeff, 0x223344, 1.0 * m]}
        position={[0, 50, 0]}
      />
      <directionalLight
        color={0xffffff}
        intensity={0.8 * m}
        position={[30, 50, 20]}
      />
      <directionalLight
        color={0xeeeeff}
        intensity={0.5 * m}
        position={[-20, 40, -30]}
      />
      <directionalLight
        color={0xffeedd}
        intensity={0.4 * m}
        position={[0, 30, -40]}
      />
    </>
  );
}

function SceneLightsDetector({ scene, onHasLights }) {
  useEffect(() => {
    if (!scene) {
      onHasLights(false);
      return;
    }
    let found = false;
    scene.traverse((child) => {
      if (child.isLight) {
        found = true;
      }
    });
    onHasLights(found);
  }, [scene, onHasLights]);

  return null;
}

function CameraController({ orthographic }) {
  const { camera, gl, set } = useThree();
  const posRef = useRef(camera.position.clone());

  useEffect(() => {
    posRef.current.copy(camera.position);
    const aspect = gl.domElement.clientWidth / gl.domElement.clientHeight;

    let newCam;
    if (orthographic) {
      const frustum = 20;
      newCam = new THREE.OrthographicCamera(
        -frustum * aspect, frustum * aspect,
        frustum, -frustum,
        0.1, 10000
      );
    } else {
      newCam = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);
    }
    newCam.position.copy(posRef.current);
    newCam.lookAt(0, 0, 0);
    set({ camera: newCam });
  }, [orthographic, gl, set]);

  return null;
}

function CameraRefExposer({ onCameraRef }) {
  const { camera } = useThree();
  useEffect(() => {
    if (onCameraRef) onCameraRef(camera);
  }, [camera, onCameraRef]);
  useFrame(() => {
    if (onCameraRef) onCameraRef(camera);
  });
  return null;
}

function FovController({ fovOverride }) {
  const { camera } = useThree();
  useEffect(() => {
    if (fovOverride && camera.isPerspectiveCamera) {
      camera.fov = fovOverride;
      camera.updateProjectionMatrix();
    } else if (!fovOverride && camera.isPerspectiveCamera && camera.fov !== 60) {
      camera.fov = 60;
      camera.updateProjectionMatrix();
    }
  }, [fovOverride, camera]);
  return null;
}

function CameraViewSwitcher({ activeCameraView, controlsRef }) {
  const { camera } = useThree();

  useEffect(() => {
    if (!activeCameraView) return;

    const { position, quaternion } = activeCameraView;
    camera.position.set(position[0], position[1], position[2]);
    const q = new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    camera.quaternion.copy(q);

    // Update OrbitControls target to a point in front of the camera
    // so the controls don't override the quaternion on the next frame
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const target = new THREE.Vector3().copy(camera.position).add(forward.multiplyScalar(100));
    if (controlsRef?.current) {
      controlsRef.current.target.copy(target);
      controlsRef.current.update();
    }
  }, [activeCameraView, camera, controlsRef]);

  return null;
}

function BackdropSkybox({ backdropImage }) {
  const { scene, gl } = useThree();
  const envMapRef = useRef(null);
  const textureRef = useRef(null);

  useEffect(() => {
    if (!backdropImage || !backdropImage.url || !backdropImage.useAsBackground) {
      scene.background = new THREE.Color("#0d1117");
      scene.environment = null;
      return;
    }

    const onLoad = (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      textureRef.current = texture;
      scene.background = texture;

      if (backdropImage.useForLighting) {
        const pmremGenerator = new THREE.PMREMGenerator(gl);
        pmremGenerator.compileEquirectangularShader();
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        scene.environment = envMap;
        envMapRef.current = envMap;
        pmremGenerator.dispose();
      } else {
        scene.environment = null;
      }
    };

    if (backdropImage.format === "exr") {
      const loader = new EXRLoader();
      loader.setDataType(THREE.HalfFloatType);
      loader.load(backdropImage.url, onLoad);
    } else if (backdropImage.format === "hdr") {
      const loader = new RGBELoader();
      loader.setDataType(THREE.HalfFloatType);
      loader.load(backdropImage.url, onLoad);
    } else {
      const loader = new THREE.TextureLoader();
      loader.load(backdropImage.url, onLoad);
    }

    return () => {
      if (textureRef.current) textureRef.current.dispose();
      if (envMapRef.current) envMapRef.current.dispose();
      textureRef.current = null;
      envMapRef.current = null;
    };
  }, [backdropImage?.url, backdropImage?.useAsBackground, backdropImage?.useForLighting, scene, gl]);

  useEffect(() => {
    if (backdropImage && backdropImage.useAsBackground) {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = backdropImage.exposure || 1.0;
    } else {
      gl.toneMapping = THREE.NoToneMapping;
      gl.toneMappingExposure = 1.0;
    }
  }, [backdropImage?.useAsBackground, backdropImage?.exposure, gl]);

  return null;
}

function GroundPlane() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[100, 100]} />
      <meshBasicMaterial color="#1a1a2e" transparent opacity={0.3} />
    </mesh>
  );
}

export default function SceneViewer({
  sceneUrl,
  volumes,
  isDrawing,
  onVolumeCreated,
  selectedVolumeId,
  editingVolumeId,
  onEditVolume,
  onEditComplete,
  shadingMode,
  orthographic,
  onSceneReady,
  detectedObjects,
  showOOBBs,
  lightingBrightness = 1.5,
  cameras = [],
  selectedCameraId,
  activeCameraView,
  onCameraRef,
  onSelectCamera,
  renderWidth = 1920,
  renderHeight = 1080,
  renderOverlays,
  fovOverride,
  sceneLights = [],
  selectedLightId,
  onSelectLight,
  analysisData,
  objectConnections = [],
  connectionObjects = [],
  selectedAnnotationId,
  onSelectAnnotation,
  annotationMode,
  onSceneMeshPick,
  pickedMeshName,
  backdropImage,
}) {
  const [sceneHasLights, setSceneHasLights] = useState(false);
  const sceneObjRef = useRef(null);
  const controlsRef = useRef(null);

  const handleSceneReady = useCallback((scene) => {
    sceneObjRef.current = scene;
    if (onSceneReady) onSceneReady(scene);
  }, [onSceneReady]);

  const handleCanvasClick = useCallback((event) => {
    if (!annotationMode || !onSceneMeshPick || !sceneObjRef.current) return;

    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    const cameraRef = controlsRef.current?.object;
    if (!cameraRef) return;

    raycaster.setFromCamera(mouse, cameraRef);
    const meshes = [];
    sceneObjRef.current.traverse((child) => {
      if (child.isMesh) meshes.push(child);
    });
    const intersects = raycaster.intersectObjects(meshes, false);
    if (intersects.length > 0) {
      const hit = intersects[0].object;
      onSceneMeshPick({ name: hit.name || hit.parent?.name || "unnamed", object: hit });
    }
  }, [annotationMode, onSceneMeshPick]);

  // Highlight exactly one picked mesh
  const pickedMeshRef = useRef(null);
  const pickedOriginalMaterial = useRef(null);
  const pickHighlightMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#ff8800", transparent: true, opacity: 0.6, side: THREE.DoubleSide,
  }), []);

  useEffect(() => {
    // Restore previous pick
    if (pickedMeshRef.current && pickedOriginalMaterial.current) {
      pickedMeshRef.current.material = pickedOriginalMaterial.current;
      pickedMeshRef.current = null;
      pickedOriginalMaterial.current = null;
    }

    if (!pickedMeshName || !sceneObjRef.current) return;

    // Find the first exact match only
    let found = false;
    sceneObjRef.current.traverse((child) => {
      if (found) return;
      if (child.isMesh && child.name === pickedMeshName) {
        pickedMeshRef.current = child;
        pickedOriginalMaterial.current = child.material;
        child.material = pickHighlightMat;
        found = true;
      }
    });

    return () => {
      if (pickedMeshRef.current && pickedOriginalMaterial.current) {
        pickedMeshRef.current.material = pickedOriginalMaterial.current;
        pickedMeshRef.current = null;
        pickedOriginalMaterial.current = null;
      }
    };
  }, [pickedMeshName, pickHighlightMat]);

  const needsLighting = shadingMode === "diffuse" || shadingMode === "shaded";

  return (
    <div className="scene-viewer" onDoubleClick={handleCanvasClick}>
      <Canvas
        camera={{ position: [5, 5, 5], fov: 60, near: 0.1, far: 10000 }}
        gl={{
          antialias: true,
          toneMapping: (shadingMode === "diffuse" || shadingMode === "shaded")
            ? THREE.ACESFilmicToneMapping
            : THREE.NoToneMapping,
          logarithmicDepthBuffer: true,
        }}
      >
        {!backdropImage?.useAsBackground && <color attach="background" args={["#0d1117"]} />}
        <CameraController orthographic={orthographic} />
        <BackdropSkybox backdropImage={backdropImage} />

        {sceneUrl && (
          <SceneModel
            url={sceneUrl}
            shadingMode={shadingMode}
            onSceneReady={handleSceneReady}
          />
        )}

        <SceneLightsDetector scene={sceneObjRef.current} onHasLights={setSceneHasLights} />

        {needsLighting && <StudioLighting brightness={1.0} />}

        <CameraRefExposer onCameraRef={onCameraRef} />
        <FovController fovOverride={fovOverride} />
        {activeCameraView && <CameraViewSwitcher activeCameraView={activeCameraView} controlsRef={controlsRef} />}

        {cameras.map((cam) => (
          <CameraFrustum
            key={cam.id}
            camera={{ ...cam, fov: fovOverride || cam.fov }}
            isSelected={cam.id === selectedCameraId}
            onDoubleClick={() => onSelectCamera && onSelectCamera(cam.id, true)}
            renderWidth={renderWidth}
            renderHeight={renderHeight}
          />
        ))}

        <GroundPlane />

        {volumes.map((vol) =>
          vol.id === editingVolumeId ? (
            <EditingVolume
              key={vol.id}
              volume={vol}
              onEditComplete={onEditComplete}
            />
          ) : (
            <VolumeBox
              key={vol.id}
              volume={vol}
              isSelected={vol.id === selectedVolumeId}
              onDoubleClick={() => onEditVolume(vol.id)}
            />
          )
        )}

        {showOOBBs && detectedObjects && detectedObjects.map((obj, i) => (
          <group key={`oobb-${i}`} onDoubleClick={(e) => {
            e.stopPropagation();
            if (onSelectAnnotation) onSelectAnnotation(obj.name);
          }}>
            <OOBBOverlay
              oobb={obj}
              color={selectedAnnotationId === obj.name ? "#ff8800" : "#44aaff"}
            />
          </group>
        ))}

        {/* Object connection lines */}
        {objectConnections.map((conn, i) => {
          const srcObj = connectionObjects.find((o) => o.name === conn.source);
          const tgtObj = connectionObjects.find((o) => o.name === conn.target);
          if (!srcObj || !tgtObj) return null;
          const color = "#ff3333";
          const verts = new Float32Array([...srcObj.center, ...tgtObj.center]);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
          return (
            <lineSegments key={`conn-${i}`} geometry={geo} renderOrder={8}>
              <lineBasicMaterial color={color} depthTest={false} linewidth={2} />
            </lineSegments>
          );
        })}

        {/* Camera distribution analysis spheres */}
        {analysisData && analysisData.spatial.perCamera && (() => {
          const camCount = Math.min(cameras.length, analysisData.spatial.perCamera.length);
          const bounds = sceneObjRef.current ? new THREE.Box3().setFromObject(sceneObjRef.current) : null;
          const sceneSize = bounds ? bounds.getSize(new THREE.Vector3()) : new THREE.Vector3(100, 100, 100);
          const sphereRadius = Math.max(sceneSize.x, sceneSize.y, sceneSize.z) * 0.001;
          return cameras.slice(0, camCount).map((cam, i) => {
            const ratio = analysisData.spatial.perCamera[i];
            const color = ratio > 2.0 ? "#0066ff"
                        : ratio > 0.7 ? "#00cc44"
                        : ratio > 0.3 ? "#ffcc00"
                        : "#ff3300";
            return (
              <mesh key={`analysis-${cam.id}`} position={cam.position} renderOrder={10}>
                <sphereGeometry args={[sphereRadius, 10, 10]} />
                <meshBasicMaterial color={color} transparent opacity={0.7} depthTest={false} />
              </mesh>
            );
          });
        })()}

        

        {/* Scene lights gizmos: cone for spot, plane for area */}
        {sceneLights.map((light) => {
          const pos = new THREE.Vector3(light.position[0], light.position[1], light.position[2]);
          const dir = new THREE.Vector3(light.direction[0], light.direction[1], light.direction[2]).normalize();
          const length = 12;
          const isSelected = light.id === selectedLightId;
          const baseColor = light.type === "area" ? "#00ccff" : "#ffff00";
          const color = isSelected ? "#ff8800" : baseColor;
          const opacity = isSelected ? 0.4 : 0.2;
          const handleClick = (e) => { e.stopPropagation(); onSelectLight && onSelectLight(light.id); };

          if (light.type === "area") {
            const q = new THREE.Quaternion(light.quaternion[0], light.quaternion[1], light.quaternion[2], light.quaternion[3]);
            const end = pos.clone().add(dir.clone().multiplyScalar(length));
            const lineVerts = new Float32Array([pos.x, pos.y, pos.z, end.x, end.y, end.z]);
            const lineGeo = new THREE.BufferGeometry();
            lineGeo.setAttribute("position", new THREE.BufferAttribute(lineVerts, 3));
            const sizeX = light.sizeX || 1.0;
            const sizeY = light.sizeY || 1.0;
            return (
              <group key={light.id} onClick={handleClick}>
                <group position={[pos.x, pos.y, pos.z]} quaternion={q}>
                  <mesh renderOrder={8}>
                    <planeGeometry args={[sizeX, sizeY]} />
                    <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
                  </mesh>
                  <lineSegments renderOrder={9}>
                    <edgesGeometry args={[new THREE.PlaneGeometry(sizeX, sizeY)]} />
                    <lineBasicMaterial color={color} depthTest={false} />
                  </lineSegments>
                </group>
                <lineSegments geometry={lineGeo} renderOrder={9}>
                  <lineBasicMaterial color={color} depthTest={false} />
                </lineSegments>
              </group>
            );
          }

          // Spot: cone shape
          const halfAngle = ((light.angle || 120) / 2) * (Math.PI / 180);
          const radius = Math.tan(halfAngle) * length;
          const end = pos.clone().add(dir.clone().multiplyScalar(length));

          const up = new THREE.Vector3(0, 1, 0);
          let right = new THREE.Vector3().crossVectors(dir, up).normalize();
          if (right.length() < 0.01) right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(1, 0, 0)).normalize();
          const coneUp = new THREE.Vector3().crossVectors(right, dir).normalize();

          const edge1 = end.clone().add(right.clone().multiplyScalar(radius));
          const edge2 = end.clone().add(right.clone().multiplyScalar(-radius));
          const edge3 = end.clone().add(coneUp.clone().multiplyScalar(radius));
          const edge4 = end.clone().add(coneUp.clone().multiplyScalar(-radius));

          const verts = new Float32Array([
            pos.x, pos.y, pos.z, end.x, end.y, end.z,
            pos.x, pos.y, pos.z, edge1.x, edge1.y, edge1.z,
            pos.x, pos.y, pos.z, edge2.x, edge2.y, edge2.z,
            pos.x, pos.y, pos.z, edge3.x, edge3.y, edge3.z,
            pos.x, pos.y, pos.z, edge4.x, edge4.y, edge4.z,
            edge1.x, edge1.y, edge1.z, edge2.x, edge2.y, edge2.z,
            edge3.x, edge3.y, edge3.z, edge4.x, edge4.y, edge4.z,
          ]);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
          return (
            <group key={light.id} onClick={handleClick}>
              <lineSegments geometry={geo} renderOrder={9}>
                <lineBasicMaterial color={color} depthTest={false} />
              </lineSegments>
              {/* Invisible click target sphere at the light origin */}
              <mesh position={[pos.x, pos.y, pos.z]} renderOrder={7}>
                <sphereGeometry args={[2, 8, 8]} />
                <meshBasicMaterial visible={false} />
              </mesh>
            </group>
          );
        })}

        {/* Render tab overlays: loaded volumes (AABBs) and objects (OOBBs) */}
        {renderOverlays && renderOverlays.volumes.map((vol, i) => (
          <mesh
            key={`rvol-${i}`}
            position={vol.center || vol.position}
            renderOrder={3}
          >
            <boxGeometry args={vol.size} />
            <meshBasicMaterial
              color={vol.id === renderOverlays.selectedVolumeId ? "#00ffaa" : "#00aaff"}
              transparent
              opacity={vol.id === renderOverlays.selectedVolumeId ? 0.15 : 0.06}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        ))}
        {renderOverlays && renderOverlays.volumes.map((vol, i) => (
          <lineSegments key={`rvol-edge-${i}`} position={vol.center || vol.position} renderOrder={4}>
            <edgesGeometry args={[new THREE.BoxGeometry(...vol.size)]} />
            <lineBasicMaterial
              color={vol.id === renderOverlays.selectedVolumeId ? "#00ffaa" : "#00aaff"}
              transparent
              opacity={0.6}
            />
          </lineSegments>
        ))}
        {renderOverlays && renderOverlays.objects.map((obj, i) => (
          <OOBBOverlay key={`robj-${i}`} oobb={obj} />
        ))}

        {isDrawing && <DrawingVolume onVolumeCreated={onVolumeCreated} />}

        <OrbitControls ref={controlsRef} makeDefault enabled={!isDrawing && !editingVolumeId} />
        <gridHelper args={[50, 50, "#333", "#222"]} />

        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport />
        </GizmoHelper>
      </Canvas>

      {isDrawing && (
        <div className="draw-hint">
          Click and drag on the ground to draw a volume. Use handles to resize. Press Enter when done.
        </div>
      )}
      {editingVolumeId && (
        <div className="draw-hint">
          Drag handles to resize/move. Press Enter to confirm changes, Escape to cancel.
        </div>
      )}
    </div>
  );
}
