import React, { useRef, useState, useCallback, useEffect } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
import { v4 as uuidv4 } from "uuid";
import VolumeBox from "./VolumeBox";
import DrawingVolume from "./DrawingVolume";
import EditingVolume from "./EditingVolume";

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

function SceneModel({ url, wireframe }) {
  const { scene } = useGLTF(url);

  useEffect(() => {
    const mat = wireframe ? wireframeMaterial : worldNormalMaterial;
    scene.traverse((child) => {
      if (child.isMesh) {
        child.material = mat;
        child.frustumCulled = true;
      }
    });
  }, [scene, wireframe]);

  return <primitive object={scene} />;
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
  wireframe,
  orthographic,
}) {
  return (
    <div className="scene-viewer">
      <Canvas
        camera={{ position: [5, 5, 5], fov: 60, near: 0.1, far: 10000 }}
        gl={{ antialias: true, toneMapping: THREE.NoToneMapping, logarithmicDepthBuffer: true }}
      >
        <color attach="background" args={["#0d1117"]} />
        <CameraController orthographic={orthographic} />

        {sceneUrl && <SceneModel url={sceneUrl} wireframe={wireframe} />}
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
