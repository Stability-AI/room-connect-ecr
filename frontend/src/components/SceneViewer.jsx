import React, { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
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

function SceneModel({ url, shadingMode, onSceneReady }) {
  const { scene } = useGLTF(url);
  const originalMaterials = useRef(new Map());
  const hasStoredOriginals = useRef(false);

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
}) {
  const [sceneHasLights, setSceneHasLights] = useState(false);
  const sceneObjRef = useRef(null);
  const controlsRef = useRef(null);

  const handleSceneReady = useCallback((scene) => {
    sceneObjRef.current = scene;
    if (onSceneReady) onSceneReady(scene);
  }, [onSceneReady]);

  const needsLighting = shadingMode === "diffuse" || shadingMode === "shaded";

  return (
    <div className="scene-viewer">
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
        <color attach="background" args={["#0d1117"]} />
        <CameraController orthographic={orthographic} />

        {sceneUrl && (
          <SceneModel
            url={sceneUrl}
            shadingMode={shadingMode}
            onSceneReady={handleSceneReady}
          />
        )}

        <SceneLightsDetector scene={sceneObjRef.current} onHasLights={setSceneHasLights} />

        {needsLighting && <StudioLighting brightness={lightingBrightness} />}

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
          <OOBBOverlay key={`oobb-${i}`} oobb={obj} />
        ))}

        {/* Scene lights visualization */}
        {sceneLights.map((light) => {
          const q = new THREE.Quaternion(light.quaternion[0], light.quaternion[1], light.quaternion[2], light.quaternion[3]);
          return (
            <group key={light.id} position={light.position} quaternion={q}>
              <mesh renderOrder={8}>
                <planeGeometry args={[light.size, light.size]} />
                <meshBasicMaterial color="#ffff44" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
              </mesh>
              <lineSegments renderOrder={9}>
                <edgesGeometry args={[new THREE.PlaneGeometry(light.size, light.size)]} />
                <lineBasicMaterial color="#ffff44" depthTest={false} />
              </lineSegments>
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
