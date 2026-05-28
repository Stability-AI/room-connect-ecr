import React, { useRef } from "react";
import * as THREE from "three";

export default function VolumeBox({ volume, isSelected, onDoubleClick }) {
  const meshRef = useRef();

  const color = isSelected ? "#00ff88" : "#4488ff";
  const opacity = isSelected ? 0.35 : 0.2;

  return (
    <group position={volume.position}>
      <mesh ref={meshRef} onDoubleClick={onDoubleClick}>
        <boxGeometry args={volume.size} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(...volume.size)]} />
        <lineBasicMaterial color={color} linewidth={2} />
      </lineSegments>
    </group>
  );
}
