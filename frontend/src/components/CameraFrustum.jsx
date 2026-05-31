import React, { useMemo } from "react";
import * as THREE from "three";

const BLENDER_FOV = 49.13; // Blender default camera FOV in degrees
const NEAR = 1.5;
const FAR = 9.0;

export default function CameraFrustum({ camera, isSelected, onDoubleClick, renderWidth = 1920, renderHeight = 1080 }) {
  const { position, quaternion, fov } = camera;
  const ASPECT = renderWidth / renderHeight;
  const cameraFov = fov || BLENDER_FOV;

  const geometry = useMemo(() => {
    const halfVFov = (cameraFov * Math.PI) / 360;
    const halfHFov = Math.atan(Math.tan(halfVFov) * ASPECT);

    const nearH = Math.tan(halfVFov) * NEAR;
    const nearW = Math.tan(halfHFov) * NEAR;
    const farH = Math.tan(halfVFov) * FAR;
    const farW = Math.tan(halfHFov) * FAR;

    const vertices = new Float32Array([
      // Origin (camera position)
      0, 0, 0,
      // Near plane corners (looking down -Z)
      -nearW, nearH, -NEAR,
       nearW, nearH, -NEAR,
       nearW, -nearH, -NEAR,
      -nearW, -nearH, -NEAR,
      // Far plane corners
      -farW, farH, -FAR,
       farW, farH, -FAR,
       farW, -farH, -FAR,
      -farW, -farH, -FAR,
    ]);

    const indices = new Uint16Array([
      // Lines from origin to far corners
      0, 5, 0, 6, 0, 7, 0, 8,
      // Near plane rectangle
      1, 2, 2, 3, 3, 4, 4, 1,
      // Far plane rectangle
      5, 6, 6, 7, 7, 8, 8, 5,
      // Connecting near to far
      1, 5, 2, 6, 3, 7, 4, 8,
    ]);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }, [ASPECT, cameraFov]);

  const faceGeometry = useMemo(() => {
    const halfVFov = (cameraFov * Math.PI) / 360;
    const halfHFov = Math.atan(Math.tan(halfVFov) * ASPECT);

    const farH = Math.tan(halfVFov) * FAR;
    const farW = Math.tan(halfHFov) * FAR;

    const vertices = new Float32Array([
      0, 0, 0,
      -farW, farH, -FAR,
       farW, farH, -FAR,
       farW, -farH, -FAR,
      -farW, -farH, -FAR,
    ]);

    const indices = new Uint16Array([
      0, 1, 2,
      0, 2, 3,
      0, 3, 4,
      0, 4, 1,
      1, 2, 3,
      1, 3, 4,
    ]);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }, [ASPECT, cameraFov]);

  const color = isSelected ? "#00ff88" : "#ffaa00";

  const quat = useMemo(
    () => new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]),
    [quaternion]
  );

  return (
    <group position={position} quaternion={quat} onDoubleClick={onDoubleClick}>
      {/* Transparent pyramid faces */}
      <mesh geometry={faceGeometry} renderOrder={5}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Wireframe edges */}
      <lineSegments geometry={geometry} renderOrder={6}>
        <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.7} />
      </lineSegments>
    </group>
  );
}

export { BLENDER_FOV };
