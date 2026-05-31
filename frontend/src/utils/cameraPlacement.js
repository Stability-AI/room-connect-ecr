import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BLENDER_FOV } from "../components/CameraFrustum";

const DEFAULT_EYE_HEIGHT_RATIO = 0.3; // 30% up from floor to ceiling
const DEFAULT_MIN_DISTANCE_RATIO = 0.02; // 2% of scene max dimension
const DEFAULT_MIN_SPACING_RATIO = 0.05; // 5% of scene max dimension
const MAX_ATTEMPTS = 10000;

/**
 * Merge all mesh geometries in the scene into a single BufferGeometry
 * with world transforms applied. Only keeps position data (strips UVs,
 * normals, etc.) to ensure attribute compatibility for merging.
 */
export function mergeSceneGeometries(scene) {
  const geometries = [];

  scene.traverse((child) => {
    if (child.isMesh && child.geometry) {
      const srcGeo = child.geometry;
      const posAttr = srcGeo.getAttribute("position");
      if (!posAttr) return;

      // Create a minimal geometry with only position data
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", posAttr.clone());
      if (srcGeo.index) {
        geo.setIndex(srcGeo.index.clone());
      }
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
  return new MeshBVH(geometry, { maxDepth: 60 });
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
 * Check if a point is inside a mesh by raycasting downward.
 * If the ray hits a surface below, the point is likely inside.
 */
function isInsideMesh(bvh, point) {
  const downRay = new THREE.Ray(point, new THREE.Vector3(0, -1, 0));
  const downHit = bvh.raycastFirst(downRay);
  if (!downHit) return false;

  // Also check upward — if both hit, we're enclosed
  const upRay = new THREE.Ray(point, new THREE.Vector3(0, 1, 0));
  const upHit = bvh.raycastFirst(upRay);

  return !!downHit && !!upHit;
}

/**
 * Generate safe camera positions using BVH proximity queries.
 * Positions are verified to be INSIDE the mesh (floor below + ceiling above).
 *
 * @param {object} params
 * @param {MeshBVH} params.bvh - BVH built from merged scene geometry
 * @param {THREE.Box3} params.bounds - Scene bounding box
 * @param {number} params.floorY - Detected floor level
 * @param {number} params.count - Number of cameras to generate
 * @returns {THREE.Vector3[]} Array of valid camera positions
 */
export function generateCameraPositions({
  bvh,
  bounds,
  floorY,
  count = 10,
  eyeHeightRatio,
  minDistanceRatio,
  minSpacingRatio,
  volumeConstraint,
}) {
  const positions = [];
  let attempts = 0;

  const sceneSize = new THREE.Vector3();
  bounds.getSize(sceneSize);
  const maxDim = Math.max(sceneSize.x, sceneSize.y, sceneSize.z);

  // Scale thresholds relative to scene size (use overrides or defaults)
  const minDistance = maxDim * (minDistanceRatio || DEFAULT_MIN_DISTANCE_RATIO);
  const minSpacing = maxDim * (minSpacingRatio || DEFAULT_MIN_SPACING_RATIO);
  const eyeHeight = sceneSize.y * (eyeHeightRatio || DEFAULT_EYE_HEIGHT_RATIO);
  const camY = floorY + eyeHeight;

  // If volume constraint is set, sample within the volume bounds instead of full scene
  let sampleBounds;
  if (volumeConstraint) {
    const vc = volumeConstraint;
    const halfSize = [vc.size[0] / 2, vc.size[1] / 2, vc.size[2] / 2];
    sampleBounds = {
      minX: vc.center[0] - halfSize[0],
      maxX: vc.center[0] + halfSize[0],
      minZ: vc.center[2] - halfSize[2],
      maxZ: vc.center[2] + halfSize[2],
    };
  } else {
    const margin = 0.1;
    sampleBounds = {
      minX: bounds.min.x + margin * sceneSize.x,
      maxX: bounds.max.x - margin * sceneSize.x,
      minZ: bounds.min.z + margin * sceneSize.z,
      maxZ: bounds.max.z - margin * sceneSize.z,
    };
  }

  while (positions.length < count && attempts < MAX_ATTEMPTS) {
    attempts++;

    // Random XZ within sample bounds
    const x = sampleBounds.minX + Math.random() * (sampleBounds.maxX - sampleBounds.minX);
    const z = sampleBounds.minZ + Math.random() * (sampleBounds.maxZ - sampleBounds.minZ);
    const candidate = new THREE.Vector3(x, camY, z);

    // Must be inside the building (floor below + ceiling above)
    if (!isInsideMesh(bvh, candidate)) continue;

    // Check distance to nearest surface (not too close to walls)
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

  if (positions.length < count) {
    console.warn(
      `[CameraPlacement] Only placed ${positions.length}/${count} cameras after ${attempts} attempts. ` +
      `Scene scale: ${maxDim.toFixed(1)}, minDist: ${minDistance.toFixed(2)}, floor: ${floorY.toFixed(2)}, camY: ${camY.toFixed(2)}`
    );
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

    // Compute quaternion using the same method as Three.js Object3D.lookAt
    // Camera convention: -Z is forward (looking direction)
    const tempObj = new THREE.Object3D();
    tempObj.position.copy(pos);
    tempObj.lookAt(lookTarget);
    const quaternion = tempObj.quaternion.clone();

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
export function autoPlaceCameras(scene, count, detectedObjects = [], maximizeEntropy = false, params = {}) {
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
    eyeHeightRatio: params.eyeHeightRatio,
    minDistanceRatio: params.minDistanceRatio,
    minSpacingRatio: params.minSpacingRatio,
    volumeConstraint: params.volumeConstraint,
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
