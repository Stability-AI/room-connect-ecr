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

    const name = (child.name || "").toLowerCase();
    const matches = terms.some((term) => name.includes(term));

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
