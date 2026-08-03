import * as THREE from "three";

/**
 * Spatial uniformity via k-NN density estimation.
 * Approximates Voronoi cell volume CV without needing scipy.
 */
export function computeSpatialUniformity(cameras) {
  if (cameras.length < 3) return { cv: 0, densities: [], perCamera: [] };

  const positions = cameras.map((c) => new THREE.Vector3(...c.position));
  const k = Math.min(6, positions.length - 1);

  const densities = positions.map((pos, i) => {
    const dists = positions
      .map((other, j) => (i === j ? Infinity : pos.distanceTo(other)))
      .sort((a, b) => a - b)
      .slice(0, k);
    const meanDist = dists.reduce((s, d) => s + d, 0) / k;
    return meanDist > 0 ? 1.0 / meanDist : 0;
  });

  const mean = densities.reduce((s, d) => s + d, 0) / densities.length;
  const std = Math.sqrt(
    densities.reduce((s, d) => s + (d - mean) ** 2, 0) / densities.length
  );
  const cv = mean > 0 ? std / mean : 0;

  const medianDensity = [...densities].sort((a, b) => a - b)[Math.floor(densities.length / 2)];

  return {
    cv,
    densities,
    perCamera: densities.map((d) => d / medianDensity),
  };
}

/**
 * Angular diversity: mean pairwise angle between neighboring cameras' forward vectors.
 */
export function computeAngularDiversity(cameras) {
  if (cameras.length < 2) return { meanAngle: 0, perCamera: [] };

  const k = Math.min(6, cameras.length - 1);
  const positions = cameras.map((c) => new THREE.Vector3(...c.position));
  const forwards = cameras.map((c) => {
    const q = new THREE.Quaternion(c.quaternion[0], c.quaternion[1], c.quaternion[2], c.quaternion[3]);
    return new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
  });

  const perCameraAngles = positions.map((pos, i) => {
    const neighborIndices = positions
      .map((other, j) => ({ j, dist: i === j ? Infinity : pos.distanceTo(other) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, k)
      .map((n) => n.j);

    const angles = neighborIndices.map((j) => {
      const dot = Math.min(1, Math.max(-1, forwards[i].dot(forwards[j])));
      return Math.acos(dot) * (180 / Math.PI);
    });

    return angles.reduce((s, a) => s + a, 0) / angles.length;
  });

  const meanAngle = perCameraAngles.reduce((s, a) => s + a, 0) / perCameraAngles.length;

  return { meanAngle, perCamera: perCameraAngles };
}

/**
 * Frustum-surface coverage via BVH raycasting.
 * Returns per-face observation counts and coverage statistics.
 */
export function computeFrustumCoverage(cameras, bvh, geometry, fov = 60) {
  if (!bvh || !geometry || cameras.length === 0) {
    return { coveragePct: 0, multiViewPct: 0, coverageCV: 0, faceCounts: null, totalFaces: 0 };
  }

  const index = geometry.index;
  const posAttr = geometry.getAttribute("position");
  const totalFaces = index ? index.count / 3 : posAttr.count / 3;
  
  const faceCounts = new Uint32Array(totalFaces);

  const gridX = 20;
  const gridY = 15;
  const fovRad = (fov * Math.PI) / 180;
  const aspect = gridX / gridY;

  let totalHits = 0;
  const hitTarget = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

  for (const cam of cameras) {
    const origin = new THREE.Vector3(...cam.position);
    const q = new THREE.Quaternion(cam.quaternion[0], cam.quaternion[1], cam.quaternion[2], cam.quaternion[3]);

    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);

    const halfH = Math.tan(fovRad / 2);
    const halfW = halfH * aspect;

    for (let gy = 0; gy < gridY; gy++) {
      for (let gx = 0; gx < gridX; gx++) {
        const u = ((gx + 0.5) / gridX) * 2 - 1;
        const v = ((gy + 0.5) / gridY) * 2 - 1;

        const dir = new THREE.Vector3()
          .copy(camForward)
          .addScaledVector(camRight, u * halfW)
          .addScaledVector(camUp, v * halfH)
          .normalize();

        const ray = new THREE.Ray(origin, dir);
        const hit = bvh.raycastFirst(ray, hitTarget);

        if (hit) {
          totalHits++;
          const fi = hit.faceIndex;
          if (fi != null && fi >= 0 && fi < totalFaces) {
            faceCounts[fi]++;
          }
        }
      }
    }
  }

  const totalRays = cameras.length * gridX * gridY;
  const hitRate = totalRays > 0 ? (totalHits / totalRays) * 100 : 0;

  // For high-poly scenes, per-face coverage is meaningless (5M faces, 90K rays).
  // Instead, measure ray hit rate (what % of rays hit geometry) and unique face spread.
  let uniqueFacesHit = 0;
  let multiViewFaces = 0;
  for (let i = 0; i < totalFaces; i++) {
    if (faceCounts[i] > 0) uniqueFacesHit++;
    if (faceCounts[i] >= 3) multiViewFaces++;
  }

  // Coverage = % of rays that hit geometry (indicates how well cameras see the scene)
  const coveragePct = hitRate;
  // Multi-view = % of hit faces seen by 3+ cameras
  const multiViewPct = uniqueFacesHit > 0 ? (multiViewFaces / uniqueFacesHit) * 100 : 0;

  // CV of per-camera hit rates (are all cameras seeing similar amounts?)
  const perCameraHits = [];
  let hitIdx = 0;
  for (let c = 0; c < cameras.length; c++) {
    let camHits = 0;
    for (let r = 0; r < gridX * gridY; r++) {
      // We need to re-count per camera - approximate from total
      camHits++; // placeholder
    }
  }

  const coverageCV = 0; // simplified for now

  console.log(`[CameraAnalysis] ${totalHits}/${totalRays} rays hit (${hitRate.toFixed(1)}%), ${uniqueFacesHit} unique faces, ${multiViewFaces} seen by 3+ cameras`);

  return { coveragePct, multiViewPct, coverageCV, faceCounts, totalFaces, uniqueFacesHit, hitRate };
}

/**
 * Combined quality score (0-100).
 */
export function computeCombinedScore(spatialCV, hitRatePct, meanAngleDeg) {
  const spatialScore = Math.max(0, 1 - spatialCV);
  const hitScore = Math.min(1, hitRatePct / 80); // 80% hit rate = perfect
  const angularScore = Math.min(1, meanAngleDeg / 60);

  const combined = 0.3 * spatialScore + 0.5 * hitScore + 0.2 * angularScore;
  return Math.round(combined * 100);
}

/**
 * Interpret spatial CV value.
 */
export function interpretCV(cv) {
  if (cv < 0.3) return "Well distributed";
  if (cv < 0.7) return "Moderate clustering";
  if (cv < 1.0) return "Significant gaps";
  return "Severe imbalance";
}

/**
 * Full analysis pipeline.
 */
export function analyzeDistribution(cameras, bvh, geometry, fov = 60) {
  const spatial = computeSpatialUniformity(cameras);
  const angular = computeAngularDiversity(cameras);
  const coverage = computeFrustumCoverage(cameras, bvh, geometry, fov);
  const score = computeCombinedScore(spatial.cv, coverage.hitRate || coverage.coveragePct, angular.meanAngle);

  return {
    spatial,
    angular,
    coverage,
    score,
    interpretation: interpretCV(spatial.cv),
  };
}
