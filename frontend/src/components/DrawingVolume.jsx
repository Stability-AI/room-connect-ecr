import React, { useState, useRef, useEffect, useCallback } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { v4 as uuidv4 } from "uuid";

const MIN_SIZE = 0.1;
const HANDLE_SCALE_FACTOR = 0.08;

export default function DrawingVolume({ onVolumeCreated }) {
  const { camera, gl, raycaster, scene } = useThree();
  const [phase, setPhase] = useState("idle"); // idle | drawing | editing
  const [startPoint, setStartPoint] = useState(null);
  const [currentPoint, setCurrentPoint] = useState(null);
  const [volumePos, setVolumePos] = useState([0, 0, 0]);
  const [volumeSize, setVolumeSize] = useState([1, 1, 1]);
  const [dragAxis, setDragAxis] = useState(null);
  const [dragType, setDragType] = useState(null); // 'scale' | 'translate'
  const [dragStart, setDragStart] = useState(null);
  const meshRef = useRef();
  const groundPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));

  const getGroundPoint = useCallback(
    (event) => {
      const rect = gl.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane.current, intersection);
      return intersection;
    },
    [camera, gl, raycaster]
  );

  useEffect(() => {
    const canvas = gl.domElement;

    const handlePointerDown = (e) => {
      if (phase === "idle") {
        const point = getGroundPoint(e);
        if (point) {
          setStartPoint(point.clone());
          setCurrentPoint(point.clone());
          setPhase("drawing");
        }
      }
    };

    const handlePointerMove = (e) => {
      if (phase === "drawing" && startPoint) {
        const point = getGroundPoint(e);
        if (point) {
          setCurrentPoint(point.clone());
          const minX = Math.min(startPoint.x, point.x);
          const maxX = Math.max(startPoint.x, point.x);
          const minZ = Math.min(startPoint.z, point.z);
          const maxZ = Math.max(startPoint.z, point.z);
          const sizeX = Math.max(maxX - minX, MIN_SIZE);
          const sizeZ = Math.max(maxZ - minZ, MIN_SIZE);
          const sizeY = Math.max(sizeX, sizeZ) * 0.5;
          setVolumeSize([sizeX, sizeY, sizeZ]);
          setVolumePos([(minX + maxX) / 2, sizeY / 2, (minZ + maxZ) / 2]);
        }
      } else if (phase === "editing" && dragAxis !== null && dragStart) {
        const point = getGroundPoint(e);
        if (!point) return;

        const delta = new THREE.Vector3().subVectors(point, dragStart);
        const axisIndex = dragAxis;

        if (dragType === "translate") {
          setVolumePos((prev) => {
            const next = [...prev];
            if (axisIndex === 0) next[0] += delta.x;
            else if (axisIndex === 1) next[1] += delta.y || delta.z * 0.5;
            else next[2] += delta.z;
            return next;
          });
        } else if (dragType === "scale") {
          setVolumeSize((prev) => {
            const next = [...prev];
            const d =
              axisIndex === 0 ? delta.x : axisIndex === 2 ? delta.z : delta.z * 0.5;
            next[axisIndex] = Math.max(MIN_SIZE, next[axisIndex] + d * 2);
            return next;
          });
        }
        setDragStart(point.clone());
      }
    };

    const handlePointerUp = () => {
      if (phase === "drawing") {
        setPhase("editing");
      }
      if (dragAxis !== null) {
        setDragAxis(null);
        setDragType(null);
        setDragStart(null);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === "Enter" && phase === "editing") {
        const center = [...volumePos];
        center[1] = volumePos[1];
        onVolumeCreated({
          id: uuidv4(),
          position: volumePos,
          size: volumeSize,
          center: center,
        });
        setPhase("idle");
        setStartPoint(null);
        setCurrentPoint(null);
      } else if (e.key === "Escape") {
        setPhase("idle");
        setStartPoint(null);
        setCurrentPoint(null);
      }
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    phase,
    startPoint,
    gl,
    camera,
    raycaster,
    getGroundPoint,
    onVolumeCreated,
    volumePos,
    volumeSize,
    dragAxis,
    dragType,
    dragStart,
  ]);

  if (phase === "idle") return null;

  const handleColors = ["#ff4444", "#44ff44", "#4444ff"];
  const maxDim = Math.max(...volumeSize);
  const handleSize = Math.max(0.3, maxDim * HANDLE_SCALE_FACTOR);

  return (
    <group position={volumePos}>
      {/* Volume box */}
      <mesh ref={meshRef} renderOrder={1}>
        <boxGeometry args={volumeSize} />
        <meshBasicMaterial
          color="#ffaa00"
          transparent
          opacity={0.25}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments renderOrder={2}>
        <edgesGeometry args={[new THREE.BoxGeometry(...volumeSize)]} />
        <lineBasicMaterial color="#ffaa00" linewidth={2} />
      </lineSegments>

      {/* Scale handles (cube) on positive face centers */}
      {phase === "editing" &&
        [0, 1, 2].map((axis) => {
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
              <meshBasicMaterial
                color={handleColors[axis]}
                depthTest={false}
                toneMapped={false}
              />
            </mesh>
          );
        })}

      {/* Translate handles (sphere) on negative face centers */}
      {phase === "editing" &&
        [0, 1, 2].map((axis) => {
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
              <meshBasicMaterial
                color={handleColors[axis]}
                depthTest={false}
                toneMapped={false}
              />
            </mesh>
          );
        })}
    </group>
  );
}
