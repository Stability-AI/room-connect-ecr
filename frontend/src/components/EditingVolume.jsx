import React, { useState, useEffect, useCallback } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

const MIN_SIZE = 0.1;
const HANDLE_SCALE_FACTOR = 0.08;

export default function EditingVolume({ volume, onEditComplete }) {
  const { camera, gl, raycaster } = useThree();
  const [volumePos, setVolumePos] = useState(volume.position);
  const [volumeSize, setVolumeSize] = useState(volume.size);
  const [dragAxis, setDragAxis] = useState(null);
  const [dragType, setDragType] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  const getGroundPoint = useCallback(
    (event) => {
      const rect = gl.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, intersection);
      return intersection;
    },
    [camera, gl, raycaster]
  );

  useEffect(() => {
    const canvas = gl.domElement;

    const handlePointerMove = (e) => {
      if (dragAxis === null || !dragStart) return;
      const point = getGroundPoint(e);
      if (!point) return;

      const delta = new THREE.Vector3().subVectors(point, dragStart);

      if (dragType === "translate") {
        setVolumePos((prev) => {
          const next = [...prev];
          if (dragAxis === 0) next[0] += delta.x;
          else if (dragAxis === 1) next[1] += delta.z * -0.5;
          else next[2] += delta.z;
          return next;
        });
      } else if (dragType === "scale") {
        setVolumeSize((prev) => {
          const next = [...prev];
          const d =
            dragAxis === 0 ? delta.x : dragAxis === 2 ? delta.z : delta.z * -0.5;
          next[dragAxis] = Math.max(MIN_SIZE, next[dragAxis] + d * 2);
          return next;
        });
      }
      setDragStart(point.clone());
    };

    const handlePointerUp = () => {
      setDragAxis(null);
      setDragType(null);
      setDragStart(null);
    };

    const handleKeyDown = (e) => {
      if (e.key === "Enter") {
        onEditComplete(volume.id, volumePos, volumeSize);
      } else if (e.key === "Escape") {
        onEditComplete(volume.id, volume.position, volume.size);
      }
    };

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [gl, getGroundPoint, dragAxis, dragType, dragStart, onEditComplete, volume, volumePos, volumeSize]);

  const handleColors = ["#ff4444", "#44ff44", "#4444ff"];
  const maxDim = Math.max(...volumeSize);
  const handleSize = Math.max(0.3, maxDim * HANDLE_SCALE_FACTOR);

  return (
    <group position={volumePos}>
      <mesh renderOrder={1}>
        <boxGeometry args={volumeSize} />
        <meshBasicMaterial
          color="#ffaa00"
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments renderOrder={2}>
        <edgesGeometry args={[new THREE.BoxGeometry(...volumeSize)]} />
        <lineBasicMaterial color="#ffaa00" linewidth={2} />
      </lineSegments>

      {/* Scale handles */}
      {[0, 1, 2].map((axis) => {
        const pos = [0, 0, 0];
        pos[axis] = volumeSize[axis] / 2 + handleSize;
        return (
          <mesh
            key={`scale-${axis}`}
            position={pos}
            renderOrder={999}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDragAxis(axis);
              setDragType("scale");
              setDragStart(getGroundPoint(e.nativeEvent));
            }}
          >
            <boxGeometry args={[handleSize, handleSize, handleSize]} />
            <meshBasicMaterial color={handleColors[axis]} depthTest={false} toneMapped={false} />
          </mesh>
        );
      })}

      {/* Translate handles */}
      {[0, 1, 2].map((axis) => {
        const pos = [0, 0, 0];
        pos[axis] = -(volumeSize[axis] / 2 + handleSize * 1.5);
        return (
          <mesh
            key={`translate-${axis}`}
            position={pos}
            renderOrder={999}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDragAxis(axis);
              setDragType("translate");
              setDragStart(getGroundPoint(e.nativeEvent));
            }}
          >
            <sphereGeometry args={[handleSize * 0.8, 12, 12]} />
            <meshBasicMaterial color={handleColors[axis]} depthTest={false} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}
