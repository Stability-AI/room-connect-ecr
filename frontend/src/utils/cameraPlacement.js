import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BLENDER_FOV } from "../components/CameraFrustum";

const DEFAULT_EYE_HEIGHT_RATIO = 0.3; // 30% up from floor to ceiling
const DEFAULT_MIN_DISTANCE_RATIO = 0.02; // 2% of scene max dimension
const DEFAULT_MIN_SPACING_RATIO = 0.05; // 5% of scene max dimension
const DEFAULT_MAX_ATTEMPTS = 10000;

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
// Height layers for splat mode (3-layer capture for optimal 3DGS reconstruction)
// Each layer has a base ratio + jitter range to spread cameras within the band
const SPLAT_HEIGHT_LAYERS = [
  { base: 0.10, jitter: 0.08, weight: 0.20 },  // low: 2%-18% of interior height
  { base: 0.40, jitter: 0.10, weight: 0.50 },  // mid: 30%-50% of interior height
  { base: 0.75, jitter: 0.10, weight: 0.30 },  // high: 65%-85% of interior height
];

function pickSplatHeightRatio() {
  const roll = Math.random();
  let cum = 0;
  for (const layer of SPLAT_HEIGHT_LAYERS) {
    cum += layer.weight;
    if (roll < cum) {
      return layer.base + (Math.random() - 0.5) * 2 * layer.jitter;
    }
  }
  return 0.40;
}

export function generateCameraPositions({
  bvh,
  bounds,
  floorY,
  count = 10,
  eyeHeightRatio,
  minDistanceRatio,
  minSpacingRatio,
  volumeConstraint,
  splatMode = false,
}) {
  const positions = [];
  let attempts = 0;
  const maxAttempts = Math.max(DEFAULT_MAX_ATTEMPTS, count * 200);

  const sceneSize = new THREE.Vector3();
  bounds.getSize(sceneSize);

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

  // Detect actual interior height via ceiling raycast (multiple probes for robustness)
  const sampleWidth = sampleBounds.maxX - sampleBounds.minX;
  const sampleDepth = sampleBounds.maxZ - sampleBounds.minZ;
  let interiorHeight = sceneSize.y;

  const probePoints = [
    [(sampleBounds.minX + sampleBounds.maxX) / 2, (sampleBounds.minZ + sampleBounds.maxZ) / 2],
    [sampleBounds.minX + sampleWidth * 0.25, sampleBounds.minZ + sampleDepth * 0.25],
    [sampleBounds.minX + sampleWidth * 0.75, sampleBounds.minZ + sampleDepth * 0.75],
  ];
  const ceilingHeights = [];
  for (const [px, pz] of probePoints) {
    const probe = new THREE.Vector3(px, floorY + 1, pz);
    const hit = bvh.raycastFirst(new THREE.Ray(probe, new THREE.Vector3(0, 1, 0)));
    if (hit) ceilingHeights.push(hit.point.y - floorY);
  }
  if (ceilingHeights.length > 0) {
    interiorHeight = ceilingHeights.reduce((a, b) => a + b, 0) / ceilingHeights.length;
    console.log(`[CameraPlacement] Interior height: ${interiorHeight.toFixed(1)} (scene height: ${sceneSize.y.toFixed(1)}, ${ceilingHeights.length} probes)`);
  }

  // Use interior AABB for constraint scaling instead of full scene AABB
  const interiorMaxDim = Math.max(sampleWidth, sampleDepth, interiorHeight);
  const minDistance = interiorMaxDim * (minDistanceRatio || DEFAULT_MIN_DISTANCE_RATIO);
  const minSpacing = interiorMaxDim * (minSpacingRatio || DEFAULT_MIN_SPACING_RATIO);

  // For non-splat mode, use single fixed height
  const fixedCamY = floorY + interiorHeight * (eyeHeightRatio || DEFAULT_EYE_HEIGHT_RATIO);

  console.log(
    `[CameraPlacement] mode=${splatMode ? "splat" : "standard"}, interiorMaxDim=${interiorMaxDim.toFixed(1)}, ` +
    `floorY=${floorY.toFixed(1)}, interiorH=${interiorHeight.toFixed(1)}, ` +
    `minDist=${minDistance.toFixed(1)}, minSpacing=${minSpacing.toFixed(1)}`
  );

  let currentMinDistance = minDistance;
  let currentMinSpacing = minSpacing;
  let stallCount = 0;
  let lastPlacedAt = 0;

  while (positions.length < count && attempts < maxAttempts) {
    attempts++;

    if (attempts - lastPlacedAt > 2000 && stallCount < 5) {
      stallCount++;
      currentMinDistance *= 0.5;
      currentMinSpacing *= 0.7;
      console.log(
        `[CameraPlacement] Relaxing (pass ${stallCount}): minDist=${currentMinDistance.toFixed(1)}, ` +
        `minSpacing=${currentMinSpacing.toFixed(1)}, placed=${positions.length}/${count}`
      );
    }

    const x = sampleBounds.minX + Math.random() * sampleWidth;
    const z = sampleBounds.minZ + Math.random() * sampleDepth;

    // Splat mode: sample from 3 height layers; standard: fixed height
    const camY = splatMode
      ? floorY + interiorHeight * pickSplatHeightRatio()
      : fixedCamY;

    const candidate = new THREE.Vector3(x, camY, z);

    if (!isInsideMesh(bvh, candidate)) continue;

    const target = {};
    const hit = bvh.closestPointToPoint(candidate, target);
    if (!hit || target.distance < currentMinDistance) continue;

    const tooClose = positions.some(
      (p) => p.distanceTo(candidate) < currentMinSpacing
    );
    if (tooClose) continue;

    positions.push(candidate);
    lastPlacedAt = attempts;
  }

  if (positions.length < count) {
    console.warn(
      `[CameraPlacement] Only placed ${positions.length}/${count} cameras after ${attempts} attempts. ` +
      `interiorMaxDim: ${interiorMaxDim.toFixed(1)}, minDist: ${currentMinDistance.toFixed(2)}, floor: ${floorY.toFixed(2)}`
    );
  }

  return { positions, interiorHeight, floorY: floorY };
}

/**
 * Compute camera orientations.
 * - Default: look at scene center
 * - maximizeEntropy: orient toward detected object clusters
 * - splatMode: random yaw + height-dependent pitch for diverse coverage
 */
export function computeCameraOrientations(
  positions,
  sceneCenter,
  detectedObjects = [],
  maximizeEntropy = false,
  { splatMode = false, interiorHeight = 1, floorY = 0 } = {}
) {
  const quaternions = [];
  const fovRad = (BLENDER_FOV * Math.PI) / 180;
  const halfFov = fovRad / 2;
  const interiorMaxDim = Math.max(interiorHeight, 1);

  for (const pos of positions) {
    let lookTarget;

    if (splatMode) {
      // Random yaw for full 360-degree horizontal coverage
      const yaw = Math.random() * Math.PI * 2;
      const lookDist = interiorMaxDim * 0.5;

      // Pitch depends on camera height layer
      const heightFrac = interiorHeight > 0 ? (pos.y - floorY) / interiorHeight : 0.4;
      let basePitchDeg;
      if (heightFrac > 0.55) {
        basePitchDeg = -20;  // high cameras look down
      } else if (heightFrac < 0.25) {
        basePitchDeg = 5;    // low cameras look slightly up
      } else {
        basePitchDeg = -5;   // mid cameras look slightly down
      }
      const pitchDeg = basePitchDeg + (Math.random() - 0.5) * 25;
      const pitch = pitchDeg * Math.PI / 180;

      lookTarget = new THREE.Vector3(
        pos.x + Math.cos(yaw) * lookDist * Math.cos(pitch),
        pos.y + Math.sin(pitch) * lookDist,
        pos.z + Math.sin(yaw) * lookDist * Math.cos(pitch),
      );
    } else if (maximizeEntropy && detectedObjects.length > 0) {
      lookTarget = findBestLookTarget(pos, detectedObjects, halfFov);
    } else {
      lookTarget = sceneCenter.clone();
      lookTarget.y = pos.y - 0.5;
    }

    const tempObj = new THREE.Object3D();
    tempObj.position.copy(pos);
    tempObj.lookAt(lookTarget);
    quaternions.push(tempObj.quaternion.clone());
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

  const { positions, interiorHeight, floorY: detectedFloorY } = generateCameraPositions({
    bvh,
    bounds,
    floorY,
    count,
    eyeHeightRatio: params.eyeHeightRatio,
    minDistanceRatio: params.minDistanceRatio,
    minSpacingRatio: params.minSpacingRatio,
    volumeConstraint: params.volumeConstraint,
    splatMode: !!params.splatMode,
  });

  const quaternions = computeCameraOrientations(
    positions,
    sceneCenter,
    detectedObjects,
    maximizeEntropy,
    { splatMode: !!params.splatMode, interiorHeight, floorY: detectedFloorY },
  );

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
