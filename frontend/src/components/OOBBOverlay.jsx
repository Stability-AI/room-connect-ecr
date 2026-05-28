import React, { useMemo } from "react";
import * as THREE from "three";

export default function OOBBOverlay({ oobb }) {
  const { center, halfExtents, quaternion } = oobb;

  const size = useMemo(
    () => [halfExtents[0] * 2, halfExtents[1] * 2, halfExtents[2] * 2],
    [halfExtents]
  );

  const rotation = useMemo(() => {
    const q = new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    const euler = new THREE.Euler().setFromQuaternion(q);
    return [euler.x, euler.y, euler.z];
  }, [quaternion]);

  const edgesGeometry = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),
    [size]
  );

  return (
    <group position={center} rotation={rotation}>
      <mesh renderOrder={10}>
        <boxGeometry args={size} />
        <meshBasicMaterial
          color="#ff6600"
          transparent
          opacity={0.12}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments renderOrder={11}>
        <primitive object={edgesGeometry} attach="geometry" />
        <lineBasicMaterial color="#ff6600" linewidth={1} depthTest={false} transparent opacity={0.8} />
      </lineSegments>
    </group>
  );
}
