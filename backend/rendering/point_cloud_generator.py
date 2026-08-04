"""Curvature-weighted point cloud generator for 3DGS initialization.

Pipeline:
  1. Join every scene mesh into one object
  2. Cache material / texture data for per-point colour sampling
  3. Compute per-vertex curvature (dihedral-angle approximation)
  4. Scatter points across the surface, density proportional to curvature x area
  5. Apply a Pointiness visualisation shader (viewport reference)
  6. Export ASCII PLY with optional scene-colour RGB and vertex normals

The curvature weighting concentrates splats along edges and geometric detail,
while MIN_DENSITY_RATIO keeps large flat surfaces covered enough to avoid holes
during early 3DGS training iterations.
"""

import logging
import random
import zipfile
from pathlib import Path

import bpy
import bmesh
import numpy as np

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------------

def _linear_to_srgb(c: float) -> float:
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * pow(c, 1.0 / 2.4) - 0.055


def _coord_xform(x, y, z, coord_system):
    if coord_system == "COLMAP":
        return (x, -z, y)
    return (x, y, z)


def _normal_xform(nx, ny, nz, coord_system):
    if coord_system == "COLMAP":
        return (nx, -nz, ny)
    return (nx, ny, nz)


def _find_shader_node(node_tree):
    for nd in node_tree.nodes:
        if nd.type == "BSDF_PRINCIPLED":
            return nd, "Base Color"
    for nd in node_tree.nodes:
        if "Color" in nd.inputs:
            return nd, "Color"
    return None, None


def _cache_materials(obj):
    DEFAULT = {"type": "constant", "color": (0.5, 0.5, 0.5)}
    cache = {}

    for idx, mat in enumerate(obj.data.materials):
        if mat is None or not mat.use_nodes:
            cache[idx] = DEFAULT
            continue

        node, inp_name = _find_shader_node(mat.node_tree)
        if node is None:
            cache[idx] = DEFAULT
            continue

        base_in = node.inputs[inp_name]

        if base_in.links:
            src = base_in.links[0].from_node
            if src.type == "TEX_IMAGE" and src.image:
                img = src.image
                w, h = img.size
                px = np.empty(w * h * 4, dtype=np.float32)
                img.pixels.foreach_get(px)
                cache[idx] = {
                    "type": "texture",
                    "pixels": px.reshape(h, w, 4),
                    "width": w,
                    "height": h,
                }
                continue

        cache[idx] = {
            "type": "constant",
            "color": tuple(base_in.default_value[:3]),
        }
    return cache


def _sample_tex(info, u, v):
    w, h = info["width"], info["height"]
    ix = int((u % 1.0) * w) % w
    iy = int((v % 1.0) * h) % h
    b = (iy * w + ix) * 4
    px = info["pixels"]
    return (px[b], px[b + 1], px[b + 2])


def _point_color(face, bu, bv, bw, uv_layer, mat_cache):
    GREY = (128, 128, 128)
    info = mat_cache.get(face.material_index)
    if info is None:
        return GREY

    if info["type"] == "texture" and uv_layer is not None:
        loops = face.loops
        uv0 = loops[0][uv_layer].uv
        uv1 = loops[1][uv_layer].uv
        uv2 = loops[2][uv_layer].uv
        su = bu * uv0.x + bv * uv1.x + bw * uv2.x
        sv = bu * uv0.y + bv * uv1.y + bw * uv2.y
        lr, lg, lb = _sample_tex(info, su, sv)
    elif info["type"] == "constant":
        lr, lg, lb = info["color"]
    else:
        return GREY

    return (
        max(0, min(255, int(_linear_to_srgb(lr) * 255 + 0.5))),
        max(0, min(255, int(_linear_to_srgb(lg) * 255 + 0.5))),
        max(0, min(255, int(_linear_to_srgb(lb) * 255 + 0.5))),
    )


# ---------------------------------------------------------------------------
#  Main generation function
# ---------------------------------------------------------------------------

def generate_point_cloud(
    target_points: int = 750_000,
    min_density_ratio: float = 0.12,
    curvature_gamma: float = 0.5,
    percentile_clip: float = 0.95,
    seed=42,
    sample_colors: bool = True,
    sample_normals: bool = True,
    coord_system: str = "COLMAP",
    output_dir: str = "/tmp",
) -> dict:
    """Generate a curvature-weighted point cloud PLY from the current bpy scene.

    Must be called after bpy scene is loaded. Returns dict with file path and stats.
    """
    if seed is not None:
        random.seed(seed)

    # ── Step 1: Join all meshes ───────────────────────────────────────────
    bpy.ops.object.select_all(action="DESELECT")
    mesh_objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]

    if not mesh_objects:
        raise RuntimeError("Scene contains no mesh objects.")

    for obj in mesh_objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)

    bpy.context.view_layer.objects.active = mesh_objects[0]

    if len(mesh_objects) > 1:
        bpy.ops.object.join()

    joined = bpy.context.active_object
    joined.name = "Joined_Mesh"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    total_faces_orig = len(joined.data.polygons)
    total_mat_slots = len(joined.data.materials)
    logger.info(
        f"Step 1: Joined {len(mesh_objects)} object(s) → 'Joined_Mesh' "
        f"({total_faces_orig:,} faces, {total_mat_slots} material slots)"
    )

    # ── Step 2: Cache material/texture data ───────────────────────────────
    mat_cache = _cache_materials(joined) if sample_colors else {}

    n_tex = sum(1 for v in mat_cache.values() if v["type"] == "texture") if mat_cache else 0
    n_const = sum(1 for v in mat_cache.values() if v["type"] == "constant") if mat_cache else 0
    logger.info(f"Step 2: Cached {n_tex} textured + {n_const} constant-colour materials")

    # ── Step 3: Build bmesh, compute per-vertex curvature ─────────────────
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = joined.evaluated_get(depsgraph)
    eval_mesh = eval_obj.to_mesh()

    bm = bmesh.new()
    bm.from_mesh(eval_mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces)

    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    n_verts = len(bm.verts)
    total_faces_tri = len(bm.faces)

    uv_layer = bm.loops.layers.uv.active if sample_colors else None

    curv_sum = [0.0] * n_verts
    curv_count = [0] * n_verts

    for edge in bm.edges:
        linked = edge.link_faces
        if len(linked) != 2:
            continue
        angle = linked[0].normal.angle(linked[1].normal, 0.0)
        for v in edge.verts:
            curv_sum[v.index] += angle
            curv_count[v.index] += 1

    for i in range(n_verts):
        if curv_count[i] > 0:
            curv_sum[i] /= curv_count[i]

    sorted_curv = sorted(curv_sum)
    c_min = sorted_curv[0]
    c_p = sorted_curv[min(len(sorted_curv) - 1, int(percentile_clip * len(sorted_curv)))]
    c_max = sorted_curv[-1]
    c_rng = c_p - c_min if (c_p - c_min) > 1e-10 else 1.0

    curv_norm = [
        min(1.0, max(0.0, (c - c_min) / c_rng)) ** curvature_gamma
        for c in curv_sum
    ]

    logger.info(
        f"Step 3: Curvature — raw [{c_min:.6f} .. {c_max:.6f}] rad, "
        f"p{int(percentile_clip * 100)} clip = {c_p:.6f}, "
        f"{n_verts:,} verts, {total_faces_tri:,} triangles"
    )

    # ── Step 4: Curvature-weighted point sampling (vectorised) ──────────
    # Extract triangle data into numpy arrays for fast batch processing.
    n_faces = len(bm.faces)
    curv_norm_arr = np.array(curv_norm, dtype=np.float64)

    # Build face vertex index + coordinate arrays
    face_vidx = np.empty((n_faces, 3), dtype=np.int32)
    face_coords = np.empty((n_faces, 3, 3), dtype=np.float64)
    face_normals = np.empty((n_faces, 3, 3), dtype=np.float64) if sample_normals else None
    face_areas = np.empty(n_faces, dtype=np.float64)
    face_mat_idx = np.empty(n_faces, dtype=np.int32)
    face_uvs = np.empty((n_faces, 3, 2), dtype=np.float64) if (sample_colors and uv_layer) else None

    logger.info("Step 4a: Extracting triangle data into arrays...")

    for fi, face in enumerate(bm.faces):
        v0, v1, v2 = face.verts
        face_vidx[fi] = [v0.index, v1.index, v2.index]
        face_coords[fi, 0] = v0.co
        face_coords[fi, 1] = v1.co
        face_coords[fi, 2] = v2.co
        face_areas[fi] = face.calc_area()
        face_mat_idx[fi] = face.material_index

        if sample_normals:
            face_normals[fi, 0] = v0.normal
            face_normals[fi, 1] = v1.normal
            face_normals[fi, 2] = v2.normal

        if face_uvs is not None:
            loops = face.loops
            face_uvs[fi, 0] = loops[0][uv_layer].uv
            face_uvs[fi, 1] = loops[1][uv_layer].uv
            face_uvs[fi, 2] = loops[2][uv_layer].uv

    bm.free()
    eval_obj.to_mesh_clear()

    logger.info("Step 4b: Computing face weights and point counts...")

    face_curv = curv_norm_arr[face_vidx].mean(axis=1)
    face_density = min_density_ratio + (1.0 - min_density_ratio) * face_curv
    face_weights = face_areas * face_density
    total_weight = face_weights.sum()

    if total_weight < 1e-12:
        raise RuntimeError("Scene has zero surface area.")

    exact_counts = target_points * face_weights / total_weight
    base_counts = exact_counts.astype(np.int32)
    fractional = exact_counts - base_counts
    rng = np.random.default_rng(seed)
    extra = (rng.random(n_faces) < fractional).astype(np.int32)
    point_counts = base_counts + extra
    actual_total = int(point_counts.sum())

    logger.info(f"Step 4c: Sampling {actual_total:,} points across {n_faces:,} faces...")

    # Assign each point to its face via repeat indices
    face_indices = np.repeat(np.arange(n_faces), point_counts)

    # Uniform barycentric coordinates (vectorised)
    r1 = rng.random(actual_total)
    r2 = rng.random(actual_total)
    s = np.sqrt(r1)
    bary_u = 1.0 - s
    bary_v = s * (1.0 - r2)
    bary_w = s * r2

    # Positions: P = u*V0 + v*V1 + w*V2
    v0 = face_coords[face_indices, 0]  # (N, 3)
    v1 = face_coords[face_indices, 1]
    v2 = face_coords[face_indices, 2]
    positions = (bary_u[:, None] * v0 + bary_v[:, None] * v1 + bary_w[:, None] * v2)

    # Apply world matrix
    mat4 = np.array(joined.matrix_world, dtype=np.float64)
    pos_h = np.ones((actual_total, 4), dtype=np.float64)
    pos_h[:, :3] = positions
    world_pos = (mat4 @ pos_h.T).T[:, :3]

    # Coordinate transform
    if coord_system == "COLMAP":
        out_pos = np.column_stack([world_pos[:, 0], -world_pos[:, 2], world_pos[:, 1]])
    else:
        out_pos = world_pos

    # Normals (interpolated + normalised)
    out_normals = None
    if sample_normals:
        n0 = face_normals[face_indices, 0]
        n1 = face_normals[face_indices, 1]
        n2 = face_normals[face_indices, 2]
        interp_n = bary_u[:, None] * n0 + bary_v[:, None] * n1 + bary_w[:, None] * n2
        norms = np.linalg.norm(interp_n, axis=1, keepdims=True)
        norms = np.where(norms < 1e-12, 1.0, norms)
        interp_n /= norms
        if coord_system == "COLMAP":
            out_normals = np.column_stack([interp_n[:, 0], -interp_n[:, 2], interp_n[:, 1]])
        else:
            out_normals = interp_n

    # Per-point curvature
    vc = curv_norm_arr[face_vidx[face_indices]]  # (N, 3)
    pt_curvature = bary_u * vc[:, 0] + bary_v * vc[:, 1] + bary_w * vc[:, 2]

    # Colours
    logger.info("Step 4d: Sampling colours...")
    if sample_colors:
        colors = np.full((actual_total, 3), 128, dtype=np.uint8)
        fi_mat = face_mat_idx[face_indices]

        for mat_i, info in mat_cache.items():
            mask = fi_mat == mat_i
            if not mask.any():
                continue

            if info["type"] == "texture" and face_uvs is not None:
                uv0 = face_uvs[face_indices[mask], 0]
                uv1 = face_uvs[face_indices[mask], 1]
                uv2 = face_uvs[face_indices[mask], 2]
                su = bary_u[mask, None] * uv0 + bary_v[mask, None] * uv1 + bary_w[mask, None] * uv2
                w, h = info["width"], info["height"]
                pixels = info["pixels"]
                ix = (su[:, 0] % 1.0 * w).astype(np.int32) % w
                iy = (su[:, 1] % 1.0 * h).astype(np.int32) % h
                sampled = pixels[iy, ix, :3]
                # Linear to sRGB (vectorised)
                lo = sampled * 12.92
                hi = 1.055 * np.power(np.clip(sampled, 0.0031309, None), 1.0 / 2.4) - 0.055
                srgb = np.where(sampled <= 0.0031308, lo, hi)
                colors[mask] = np.clip(srgb * 255 + 0.5, 0, 255).astype(np.uint8)
            elif info["type"] == "constant":
                lr, lg, lb = info["color"]
                sr = _linear_to_srgb(lr)
                sg = _linear_to_srgb(lg)
                sb = _linear_to_srgb(lb)
                colors[mask] = [
                    max(0, min(255, int(sr * 255 + 0.5))),
                    max(0, min(255, int(sg * 255 + 0.5))),
                    max(0, min(255, int(sb * 255 + 0.5))),
                ]
    else:
        g_vals = np.clip((pt_curvature * 255).astype(np.int32), 0, 255).astype(np.uint8)
        colors = np.column_stack([g_vals, g_vals, g_vals])

    # Shuffle to break spatial ordering
    perm = rng.permutation(actual_total)
    out_pos = out_pos[perm]
    if out_normals is not None:
        out_normals = out_normals[perm]
    colors = colors[perm]
    pt_curvature = pt_curvature[perm]

    logger.info(
        f"Step 4: Sampled {actual_total:,} points "
        f"[colours={'scene' if sample_colors else 'curvature'} "
        f"normals={'on' if sample_normals else 'off'} "
        f"coords={coord_system}]"
    )

    # ── Step 5: Apply pointiness visualization material ───────────────────
    joined.data.materials.clear()

    mat = bpy.data.materials.new(name="Pointiness_Viz")
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()

    nd_geom = tree.nodes.new("ShaderNodeNewGeometry")
    nd_ramp = tree.nodes.new("ShaderNodeValToRGB")
    nd_emit = tree.nodes.new("ShaderNodeEmission")
    nd_out = tree.nodes.new("ShaderNodeOutputMaterial")

    nd_geom.location = (-600, 0)
    nd_ramp.location = (-300, 0)
    nd_emit.location = (50, 0)
    nd_out.location = (300, 0)

    ramp = nd_ramp.color_ramp
    ramp.elements[0].position = 0.0
    ramp.elements[0].color = (0, 0, 0, 1)
    ramp.elements[1].position = 1.0
    ramp.elements[1].color = (1, 1, 1, 1)

    tree.links.new(nd_geom.outputs["Pointiness"], nd_ramp.inputs["Fac"])
    tree.links.new(nd_ramp.outputs["Color"], nd_emit.inputs["Color"])
    tree.links.new(nd_emit.outputs["Emission"], nd_out.inputs["Surface"])

    joined.data.materials.append(mat)
    logger.info("Step 5: Pointiness visualisation material applied")

    # ── Step 6: Export PLY ─────────────────────────────────────────────────
    output_path = Path(output_dir) / "curvature_points3d.ply"

    with open(output_path, "w") as f:
        f.write("ply\n")
        f.write("format ascii 1.0\n")
        f.write(f"element vertex {actual_total}\n")
        f.write("property float x\n")
        f.write("property float y\n")
        f.write("property float z\n")
        if sample_normals:
            f.write("property float nx\n")
            f.write("property float ny\n")
            f.write("property float nz\n")
        f.write("property uchar red\n")
        f.write("property uchar green\n")
        f.write("property uchar blue\n")
        f.write("property float curvature\n")
        f.write("end_header\n")

        # Write in chunks for speed
        chunk_size = 50_000
        for start in range(0, actual_total, chunk_size):
            end = min(start + chunk_size, actual_total)
            lines = []
            for i in range(start, end):
                p = out_pos[i]
                c = colors[i]
                cv = pt_curvature[i]
                if sample_normals:
                    n = out_normals[i]
                    lines.append(
                        f"{p[0]:.6f} {p[1]:.6f} {p[2]:.6f} "
                        f"{n[0]:.6f} {n[1]:.6f} {n[2]:.6f} "
                        f"{c[0]} {c[1]} {c[2]} {cv:.6f}\n"
                    )
                else:
                    lines.append(
                        f"{p[0]:.6f} {p[1]:.6f} {p[2]:.6f} "
                        f"{c[0]} {c[1]} {c[2]} {cv:.6f}\n"
                    )
            f.write("".join(lines))

    logger.info(f"Step 6: Exported PLY → {output_path} ({actual_total:,} vertices)")

    # ── ZIP the PLY ───────────────────────────────────────────────────────
    zip_path = Path(output_dir) / "point_cloud.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(output_path, "curvature_points3d.ply")

    return {
        "ply_path": str(output_path),
        "zip_path": str(zip_path),
        "total_points": actual_total,
        "total_faces": total_faces_tri,
        "total_materials": total_mat_slots,
        "textured_materials": n_tex,
        "constant_materials": n_const,
        "curvature_range": [float(c_min), float(c_max)],
        "percentile_clip_value": float(c_p),
        "coord_system": coord_system,
        "colors": "scene" if sample_colors else "curvature",
        "normals": sample_normals,
        "seed": seed,
    }


# ---------------------------------------------------------------------------
#  Point cloud statistics (curvature–density verification)
# ---------------------------------------------------------------------------

def _load_ply(path: str):
    """Load ASCII PLY returning (N×3 xyz, N curvature-or-None)."""
    with open(path, "r") as fh:
        n_verts = 0
        properties = []
        for line in fh:
            stripped = line.strip()
            if stripped.startswith("element vertex"):
                n_verts = int(stripped.split()[-1])
            elif stripped.startswith("property"):
                parts = stripped.split()
                properties.append((parts[2], parts[1]))
            elif stripped == "end_header":
                break

        n_cols = len(properties)
        col_idx = {name: i for i, (name, _) in enumerate(properties)}

        data = np.empty((n_verts, n_cols), dtype=np.float64)
        for i, line in enumerate(fh):
            if i >= n_verts:
                break
            data[i] = [float(v) for v in line.split()[:n_cols]]

    xyz = np.column_stack([data[:, col_idx[c]] for c in ("x", "y", "z")])

    curvature = None
    if "curvature" in col_idx:
        curvature = data[:, col_idx["curvature"]]

    return xyz, curvature


def _compute_local_density(points: np.ndarray, k: int = 12) -> np.ndarray:
    """Local density via k-nearest-neighbour mean distance."""
    try:
        from scipy.spatial import cKDTree

        tree = cKDTree(points)
        dists, _ = tree.query(points, k=k + 1)
        mean_dist = dists[:, 1:].mean(axis=1)
    except ImportError:
        logger.warning("scipy not available — falling back to brute-force KNN")
        n = len(points)
        mean_dist = np.empty(n)
        for i in range(n):
            d = np.linalg.norm(points - points[i], axis=1)
            d.sort()
            mean_dist[i] = d[1 : k + 1].mean()

    return 1.0 / (mean_dist + 1e-12)


def _norm01(arr: np.ndarray) -> np.ndarray:
    lo, hi = arr.min(), arr.max()
    return (arr - lo) / (hi - lo + 1e-12)


def compute_point_cloud_stats(
    ply_path: str,
    stats_sample: int = 80_000,
    knn_k: int = 12,
) -> dict:
    """Analyze a generated PLY for curvature–density correlation.

    Returns JSON-serializable statistics dict.
    """
    logger.info(f"Loading PLY: {ply_path}")
    xyz, curvature_prop = _load_ply(ply_path)
    n_total = len(xyz)

    if curvature_prop is not None:
        curvature_full = curvature_prop
        curv_source = "PLY 'curvature' property"
    else:
        curvature_full = np.zeros(n_total)
        curv_source = "none (all zeros)"

    logger.info(f"  {n_total:,} vertices, curvature source: {curv_source}")

    rng = np.random.default_rng(0)
    sample_size = min(stats_sample, n_total)
    stat_idx = rng.choice(n_total, size=sample_size, replace=False)
    stat_pts = xyz[stat_idx]
    stat_curv = curvature_full[stat_idx]

    logger.info(f"Computing local density on {sample_size:,} points (k={knn_k})")
    stat_density = _compute_local_density(stat_pts, k=knn_k)
    stat_density_n = _norm01(stat_density)

    r = float(np.corrcoef(stat_curv, stat_density_n)[0, 1])
    z = np.polyfit(stat_curv, stat_density_n, 1)

    q_edges = [0.0, 0.25, 0.50, 0.75, 1.0]
    q_labels = ["0–25%", "25–50%", "50–75%", "75–100%"]
    quartiles = []
    for i, (lo, hi) in enumerate(zip(q_edges[:-1], q_edges[1:])):
        mask = (stat_curv >= lo) & (stat_curv < hi + 1e-9)
        quartiles.append({
            "range": q_labels[i],
            "point_count": int(mask.sum()),
            "mean_density": round(float(stat_density_n[mask].mean()), 6) if mask.any() else 0.0,
        })

    result = {
        "total_points": n_total,
        "stats_sample": sample_size,
        "knn_k": knn_k,
        "pearson_r": round(r, 6) if not np.isnan(r) else 0.0,
        "linear_fit": {
            "slope": round(float(z[0]), 6),
            "intercept": round(float(z[1]), 6),
        },
        "curvature_source": curv_source,
        "curvature_distribution": {
            "min": round(float(stat_curv.min()), 6),
            "max": round(float(stat_curv.max()), 6),
            "mean": round(float(stat_curv.mean()), 6),
            "median": round(float(np.median(stat_curv)), 6),
            "std": round(float(stat_curv.std()), 6),
        },
        "density_distribution": {
            "min": round(float(stat_density_n.min()), 6),
            "max": round(float(stat_density_n.max()), 6),
            "mean": round(float(stat_density_n.mean()), 6),
            "median": round(float(np.median(stat_density_n)), 6),
            "std": round(float(stat_density_n.std()), 6),
        },
        "quartiles": quartiles,
    }

    logger.info(f"Stats complete: Pearson r = {result['pearson_r']}")
    return result
