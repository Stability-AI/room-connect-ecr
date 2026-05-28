import React, { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { v4 as uuidv4 } from "uuid";
import VolumeBox from "./VolumeBox";
import DrawingVolume from "./DrawingVolume";
import EditingVolume from "./EditingVolume";
import OOBBOverlay from "./OOBBOverlay";

RectAreaLightUniformsLib.init();

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
          case "textured": {
            const orig = originalMaterials.current.get(child.uuid);
            if (orig) {
              child.material = orig;
            }
            break;
          }
        }
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

function StudioLighting() {
  const rectLightRef = useRef();

  useEffect(() => {
    if (rectLightRef.current) {
      rectLightRef.current.lookAt(0, 0, 0);
    }
  }, []);

  return (
    <>
      <ambientLight intensity={0.1} color={0xffffff} />
      <hemisphereLight
        args={[0xddeeff, 0x0f1115, 0.6]}
        position={[0, 50, 0]}
      />
      <rectAreaLight
        ref={rectLightRef}
        args={[0xffffff, 20.0, 10, 5]}
        position={[0, 5, -10]}
      />
      <rectAreaLight
        args={[0xffffff, 10.0, 8, 4]}
        position={[10, 4, 5]}
        rotation={[0, -Math.PI / 3, 0]}
      />
      <rectAreaLight
        args={[0xffffff, 5.0, 6, 3]}
        position={[-8, 3, 8]}
        rotation={[0, Math.PI / 4, 0]}
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
}) {
  const [sceneHasLights, setSceneHasLights] = useState(false);
  const sceneObjRef = useRef(null);

  const handleSceneReady = useCallback((scene) => {
    sceneObjRef.current = scene;
    if (onSceneReady) onSceneReady(scene);
  }, [onSceneReady]);

  const needsLighting = shadingMode === "diffuse" || (shadingMode === "textured" && !sceneHasLights);

  return (
    <div className="scene-viewer">
      <Canvas
        camera={{ position: [5, 5, 5], fov: 60, near: 0.1, far: 10000 }}
        gl={{
          antialias: true,
          toneMapping: (shadingMode === "diffuse" || shadingMode === "textured")
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

        {needsLighting && <StudioLighting />}

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

        {isDrawing && <DrawingVolume onVolumeCreated={onVolumeCreated} />}

        <OrbitControls makeDefault enabled={!isDrawing && !editingVolumeId} />
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
