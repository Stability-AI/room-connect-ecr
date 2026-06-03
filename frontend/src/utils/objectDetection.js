import * as THREE from "three";

/**
 * Traverse a GLTF scene and return meshes whose names match the filter terms.
 * Matching is case-insensitive substring search.
 *
 * @param {THREE.Object3D} scene - The root scene object
 * @param {string[]} filterTerms - Array of substrings to match against mesh names
 * @param {boolean} exclusive - If true, exclude matching objects; if false, include them
 * @returns {THREE.Mesh[]} Array of matching meshes
 */
export function filterMeshesByName(scene, filterTerms, exclusive = false) {
  const meshes = [];
  const terms = filterTerms.map((t) => t.trim().toLowerCase()).filter(Boolean);

  if (terms.length === 0) return meshes;

  scene.traverse((child) => {
    if (!child.isMesh) return;

    // Check the mesh name, its parent name (Blender object name), and ancestors
    const meshName = (child.name || "").toLowerCase();
    const parentName = (child.parent?.name || "").toLowerCase();
    const grandparentName = (child.parent?.parent?.name || "").toLowerCase();
    const combinedName = `${meshName} ${parentName} ${grandparentName}`;

    const matches = terms.some((term) => combinedName.includes(term));

    if (exclusive ? !matches : matches) {
      meshes.push(child);
    }
  });

  return meshes;
}

/**
 * Compute the Oriented Bounding Box (OOBB) for a mesh in world space.
 * Since we work with axis-aligned volumes, we compute the AABB in world space
 * which accounts for the mesh's world transform (position, rotation, scale).
 *
 * @param {THREE.Mesh} mesh - The mesh to compute OOBB for
 * @returns {{ center: number[], halfExtents: number[], rotation: number[], worldPosition: number[], worldScale: number[], name: string }}
 */
export function computeOOBB(mesh) {
  mesh.updateWorldMatrix(true, false);

  const geometry = mesh.geometry;
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }

  const localBox = geometry.boundingBox.clone();
  const worldMatrix = mesh.matrixWorld;

  // Extract rotation and scale from world matrix
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  worldMatrix.decompose(position, quaternion, scale);

  // Compute world-space center of the bounding box
  const localCenter = new THREE.Vector3();
  localBox.getCenter(localCenter);
  localCenter.applyMatrix4(worldMatrix);

  // Half extents in local space, scaled by world scale
  const localSize = new THREE.Vector3();
  localBox.getSize(localSize);
  const halfExtents = new THREE.Vector3(
    (localSize.x * scale.x) / 2,
    (localSize.y * scale.y) / 2,
    (localSize.z * scale.z) / 2
  );

  // Rotation as a 3x3 matrix (row-major array)
  const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
  const rotArray = [
    rotMatrix.elements[0], rotMatrix.elements[4], rotMatrix.elements[8],
    rotMatrix.elements[1], rotMatrix.elements[5], rotMatrix.elements[9],
    rotMatrix.elements[2], rotMatrix.elements[6], rotMatrix.elements[10],
  ];

  return {
    name: mesh.name || "unnamed",
    center: [localCenter.x, localCenter.y, localCenter.z],
    halfExtents: [halfExtents.x, halfExtents.y, halfExtents.z],
    rotation: rotArray,
    worldPosition: [position.x, position.y, position.z],
    worldScale: [scale.x, scale.y, scale.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
  };
}

/**
 * Detect objects in a scene and compute their OOBBs.
 *
 * @param {THREE.Object3D} scene
 * @param {string[]} filterTerms
 * @param {boolean} exclusive
 * @returns {Array} Array of OOBB data objects
 */
export function detectObjects(scene, filterTerms, exclusive = false) {
  const meshes = filterMeshesByName(scene, filterTerms, exclusive);
  return meshes.map((mesh) => computeOOBB(mesh));
}

/**
 * Compute the volume of an OOBB from its half-extents.
 */
function oobbVolume(oobb) {
  return oobb.halfExtents[0] * oobb.halfExtents[1] * oobb.halfExtents[2] * 8;
}

/**
 * Check if a smaller OOBB is contained within (or nearly co-located with) a larger OOBB.
 * Uses center distance relative to the larger box's extents as the containment test.
 *
 * @param {object} smaller - The smaller OOBB
 * @param {object} larger - The larger OOBB
 * @param {number} threshold - Position similarity threshold (0.95 = 95% overlap)
 * @returns {boolean}
 */
function isContainedOrColocated(smaller, larger, threshold = 0.95) {
  const dx = Math.abs(smaller.center[0] - larger.center[0]);
  const dy = Math.abs(smaller.center[1] - larger.center[1]);
  const dz = Math.abs(smaller.center[2] - larger.center[2]);

  const withinX = dx + smaller.halfExtents[0] <= larger.halfExtents[0] * (1 + (1 - threshold));
  const withinY = dy + smaller.halfExtents[1] <= larger.halfExtents[1] * (1 + (1 - threshold));
  const withinZ = dz + smaller.halfExtents[2] <= larger.halfExtents[2] * (1 + (1 - threshold));

  if (withinX && withinY && withinZ) return true;

  // Also check position similarity (centers within 5% of larger's extent)
  const lExtent = Math.max(...larger.halfExtents) * 2;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const positionSimilarity = 1 - (dist / (lExtent || 1));

  return positionSimilarity >= threshold;
}

/**
 * Cull smaller OOBBs that are fully contained within or nearly co-located
 * with a larger OOBB. Keeps the larger box, removes the smaller duplicates.
 *
 * @param {Array} objects - Array of OOBB data objects
 * @param {number} threshold - Similarity threshold (default 0.95)
 * @returns {Array} Filtered array with redundant smaller OOBBs removed
 */
export function cullOverlappingOOBBs(objects, threshold = 0.95) {
  if (objects.length <= 1) return objects;

  const sorted = [...objects].sort((a, b) => oobbVolume(b) - oobbVolume(a));
  const kept = [];
  const removed = new Set();

  for (let i = 0; i < sorted.length; i++) {
    if (removed.has(i)) continue;

    kept.push(sorted[i]);

    for (let j = i + 1; j < sorted.length; j++) {
      if (removed.has(j)) continue;

      if (isContainedOrColocated(sorted[j], sorted[i], threshold)) {
        removed.add(j);
      }
    }
  }

  return kept;
}
