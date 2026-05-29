import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BLENDER_FOV } from "../components/CameraFrustum";

const DEFAULT_EYE_HEIGHT = 1.6;
const DEFAULT_MIN_DISTANCE = 5.0;
const DEFAULT_MIN_SPACING = 1.3;
const MAX_ATTEMPTS = 5000;

/**
 * Merge all mesh geometries in the scene into a single BufferGeometry
 * with world transforms applied.
 */
export function mergeSceneGeometries(scene) {
  const geometries = [];

  scene.traverse((child) => {
    if (child.isMesh && child.geometry) {
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      geometries.push(geo);
    }
  });

  if (geometries.length === 0) return null;
  return mergeGeometries(geometries, false);
}

/**
 * Build a BVH from a merged geometry for fast proximity queries.
 */
export function buildSceneBVH(geometry) {
  return new MeshBVH(geometry);
}

/**
 * Detect floor level as the 5th percentile of Y-axis vertex positions.
 */
export function detectFloorLevel(geometry) {
  const posAttr = geometry.getAttribute("position");
  const yValues = [];

  for (let i = 0; i < posAttr.count; i++) {
    yValues.push(posAttr.getY(i));
  }

  yValues.sort((a, b) => a - b);
  const idx = Math.floor(yValues.length * 0.05);
  return yValues[idx];
}

/**
 * Compute the axis-aligned bounding box of the geometry.
 */
function computeBounds(geometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox;
}

/**
 * Generate safe camera positions using BVH proximity queries.
 *
 * @param {object} params
 * @param {MeshBVH} params.bvh - BVH built from merged scene geometry
 * @param {THREE.Box3} params.bounds - Scene bounding box
 * @param {number} params.floorY - Detected floor level
 * @param {number} params.count - Number of cameras to generate
 * @param {number} params.minDistance - Minimum distance from nearest surface
 * @param {number} params.minSpacing - Minimum distance between cameras
 * @param {number} params.eyeHeight - Camera height above floor
 * @returns {THREE.Vector3[]} Array of valid camera positions
 */
export function generateCameraPositions({
  bvh,
  bounds,
  floorY,
  count = 10,
  minDistance = DEFAULT_MIN_DISTANCE,
  minSpacing = DEFAULT_MIN_SPACING,
  eyeHeight = DEFAULT_EYE_HEIGHT,
}) {
  const positions = [];
  let attempts = 0;

  const camY = floorY + eyeHeight;

  while (positions.length < count && attempts < MAX_ATTEMPTS) {
    attempts++;

    // Random XZ within scene bounds
    const x = bounds.min.x + Math.random() * (bounds.max.x - bounds.min.x);
    const z = bounds.min.z + Math.random() * (bounds.max.z - bounds.min.z);
    const candidate = new THREE.Vector3(x, camY, z);

    // Check distance to nearest surface
    const target = {};
    const hit = bvh.closestPointToPoint(candidate, target);
    if (!hit || target.distance < minDistance) continue;

    // Check spacing from existing cameras
    const tooClose = positions.some(
      (p) => p.distanceTo(candidate) < minSpacing
    );
    if (tooClose) continue;

    positions.push(candidate);
  }

  return positions;
}

/**
 * Compute camera orientations. Default: look at scene center.
 * If maximizeEntropy is true and detectedObjects are provided,
 * orient each camera toward the centroid of detected OOBB centers
 * that are visible from that position.
 *
 * @param {THREE.Vector3[]} positions - Camera positions
 * @param {THREE.Vector3} sceneCenter - Center of scene bounds
 * @param {object[]} detectedObjects - Array of OOBB data objects (optional)
 * @param {boolean} maximizeEntropy - Whether to optimize rotation for object visibility
 * @returns {THREE.Quaternion[]} Array of camera quaternions
 */
export function computeCameraOrientations(
  positions,
  sceneCenter,
  detectedObjects = [],
  maximizeEntropy = false
) {
  const quaternions = [];
  const fovRad = (BLENDER_FOV * Math.PI) / 180;
  const halfFov = fovRad / 2;

  for (const pos of positions) {
    let lookTarget;

    if (maximizeEntropy && detectedObjects.length > 0) {
      // Find the rotation that maximizes the number of detected objects in view
      lookTarget = findBestLookTarget(pos, detectedObjects, halfFov);
    } else {
      // Default: look at scene center at a slightly lower height
      lookTarget = sceneCenter.clone();
      lookTarget.y = pos.y - 0.5;
    }

    // Compute quaternion from look-at direction
    const direction = new THREE.Vector3().subVectors(lookTarget, pos).normalize();
    const quaternion = new THREE.Quaternion();

    // Three.js camera looks down -Z, so we use a lookAt matrix
    const lookMatrix = new THREE.Matrix4();
    lookMatrix.lookAt(pos, lookTarget, new THREE.Vector3(0, 1, 0));
    quaternion.setFromRotationMatrix(lookMatrix);

    quaternions.push(quaternion);
  }

  return quaternions;
}

/**
 * Find the look-at target that maximizes the number of detected objects
 * within the camera's field of view.
 */
function findBestLookTarget(cameraPos, detectedObjects, halfFov) {
  const objectCenters = detectedObjects.map(
    (obj) => new THREE.Vector3(obj.center[0], obj.center[1], obj.center[2])
  );

  if (objectCenters.length === 0) {
    return new THREE.Vector3(0, cameraPos.y, 0);
  }

  // Compute weighted centroid of all object centers
  const centroid = new THREE.Vector3();
  for (const c of objectCenters) {
    centroid.add(c);
  }
  centroid.divideScalar(objectCenters.length);

  // Score candidate directions: centroid, and a few variations
  const candidates = [centroid];

  // Add cluster-based candidates (divide objects into quadrants)
  const quadrants = [[], [], [], []];
  for (const c of objectCenters) {
    const dx = c.x - cameraPos.x;
    const dz = c.z - cameraPos.z;
    const qi = (dx >= 0 ? 0 : 1) + (dz >= 0 ? 0 : 2);
    quadrants[qi].push(c);
  }

  for (const quad of quadrants) {
    if (quad.length > 0) {
      const qCentroid = new THREE.Vector3();
      for (const c of quad) qCentroid.add(c);
      qCentroid.divideScalar(quad.length);
      candidates.push(qCentroid);
    }
  }

  // Score each candidate by counting objects within FOV cone
  let bestTarget = centroid;
  let bestScore = -1;

  for (const target of candidates) {
    const viewDir = new THREE.Vector3().subVectors(target, cameraPos).normalize();
    let score = 0;

    for (const objCenter of objectCenters) {
      const toObj = new THREE.Vector3().subVectors(objCenter, cameraPos).normalize();
      const angle = Math.acos(Math.min(1, viewDir.dot(toObj)));
      if (angle < halfFov) {
        score++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestTarget = target;
    }
  }

  return bestTarget;
}

/**
 * Full auto-placement pipeline: merge geometry, build BVH, sample positions,
 * compute orientations.
 *
 * @param {THREE.Object3D} scene - The loaded GLTF scene
 * @param {number} count - Number of cameras to generate
 * @param {object[]} detectedObjects - Detected OOBB data (for entropy)
 * @param {boolean} maximizeEntropy - Whether to optimize for object visibility
 * @returns {{ positions: number[][], quaternions: number[][] }} Camera data ready for state
 */
export function autoPlaceCameras(scene, count, detectedObjects = [], maximizeEntropy = false) {
  const mergedGeo = mergeSceneGeometries(scene);
  if (!mergedGeo) {
    console.warn("[CameraPlacement] No mesh geometry found in scene");
    return { cameras: [] };
  }

  const bvh = buildSceneBVH(mergedGeo);
  const bounds = computeBounds(mergedGeo);
  const floorY = detectFloorLevel(mergedGeo);
  const sceneCenter = new THREE.Vector3();
  bounds.getCenter(sceneCenter);

  const positions = generateCameraPositions({
    bvh,
    bounds,
    floorY,
    count,
  });

  const quaternions = computeCameraOrientations(
    positions,
    sceneCenter,
    detectedObjects,
    maximizeEntropy
  );

  // Clean up
  mergedGeo.dispose();

  return {
    cameras: positions.map((pos, i) => ({
      position: [pos.x, pos.y, pos.z],
      quaternion: [
        quaternions[i].x,
        quaternions[i].y,
        quaternions[i].z,
        quaternions[i].w,
      ],
    })),
  };
}
