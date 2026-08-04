"""Scene analysis module for GLB/glTF scenes loaded in Blender.

Provides PBR material detection, mesh topology analysis, and scene-level
aggregate metrics. All functions operate on bpy objects after scene load.
"""

import logging
import numpy as np
import bpy
import bmesh
import mathutils

logger = logging.getLogger(__name__)


def trace_to_image_texture(node, visited=None):
    """Recursively trace back from a node to find if it connects to an image texture."""
    if visited is None:
        visited = set()
    if node in visited:
        return False
    visited.add(node)

    if node.type == 'TEX_IMAGE':
        return True

    for input_socket in node.inputs:
        if input_socket.is_linked:
            for link in input_socket.links:
                if trace_to_image_texture(link.from_node, visited):
                    return True
    return False


def check_for_pbr(mesh_obj):
    """Check if a mesh object has PBR materials via Principled BSDF analysis.

    Compatible with Blender 4.0+ input naming. Handles intermediary nodes.
    """
    results = {
        "uses_principled_bsdf": False,
        "has_pbr_textures": False,
        "pbr_complete": False,
        "pbr_details": {
            "materials_with_principled": 0,
            "total_materials": 0,
            "texture_types_found": []
        }
    }

    mesh = mesh_obj.data
    if not mesh.materials:
        return results

    results["pbr_details"]["total_materials"] = len(mesh.materials)
    texture_types_found = set()
    materials_with_principled = 0

    pbr_inputs = {
        "Base Color": "albedo",
        "Metallic": "metallic",
        "Roughness": "roughness",
        "Alpha": "alpha",
        "Normal": "normal",
        "Subsurface Weight": "subsurface",
        "Subsurface Radius": "subsurface_radius",
        "Specular IOR Level": "specular",
        "Anisotropic": "anisotropic",
        "Transmission Weight": "transmission",
        "Coat Weight": "coat",
        "Coat Roughness": "coat_roughness",
        "Coat Normal": "coat_normal",
        "Sheen Weight": "sheen",
        "Emission Color": "emission",
    }

    for mat in mesh.materials:
        if not mat or not mat.use_nodes or not mat.node_tree:
            continue

        principled_nodes = [n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED']
        if not principled_nodes:
            continue

        results["uses_principled_bsdf"] = True
        materials_with_principled += 1

        for principled_node in principled_nodes:
            for input_name, tex_type in pbr_inputs.items():
                if input_name in principled_node.inputs and principled_node.inputs[input_name].is_linked:
                    for link in principled_node.inputs[input_name].links:
                        if trace_to_image_texture(link.from_node):
                            texture_types_found.add(tex_type)
                            break

    results["pbr_details"]["materials_with_principled"] = materials_with_principled
    results["pbr_details"]["texture_types_found"] = sorted(list(texture_types_found))

    if results["uses_principled_bsdf"] and len(texture_types_found) > 0:
        results["has_pbr_textures"] = True

    has_albedo = "albedo" in texture_types_found
    has_roughness_or_metallic = "roughness" in texture_types_found or "metallic" in texture_types_found
    if results["uses_principled_bsdf"] and has_albedo and has_roughness_or_metallic:
        results["pbr_complete"] = True

    return results


def analyze_mesh(mesh_obj):
    """Analyze a mesh object for topology, PBR, and geometry quality."""
    mesh = mesh_obj.data

    result = {
        "name": mesh_obj.name,
        "primary_analysis": {
            "vertex_count": len(mesh.vertices),
            "face_count": len(mesh.polygons),
            "mesh_parts": {"count": 0},
            "has_uv_maps": len(mesh.uv_layers) > 0,
            "uv_map_count": len(mesh.uv_layers),
            "has_materials": len(mesh.materials) > 0,
            "material_count": len(mesh.materials),
            "has_groups": len(mesh_obj.vertex_groups) > 0,
            "group_count": len(mesh_obj.vertex_groups),
        },
        "secondary_analysis": {
            "is_watertight": False,
            "has_intersecting_faces": False,
            "normal_analysis": {"has_normals": False, "all_normals_outward": False},
            "is_smooth": False,
            "surface_area_analysis": {"has_uneven_areas": False, "average_area": 0.0},
        },
        "pbr_analysis": check_for_pbr(mesh_obj),
    }

    if len(mesh.vertices) == 0 or len(mesh.polygons) == 0:
        return result

    try:
        bm = bmesh.new()
        bm.from_mesh(mesh)

        # Connected components
        unvisited = set(bm.verts)
        parts_count = 0
        while unvisited:
            start = next(iter(unvisited))
            stack = [start]
            component = set()
            while stack:
                v = stack.pop()
                if v not in component:
                    component.add(v)
                    for e in v.link_edges:
                        other = e.other_vert(v)
                        if other not in component:
                            stack.append(other)
            unvisited -= component
            parts_count += 1

        result["primary_analysis"]["mesh_parts"]["count"] = parts_count

        # Watertight check
        boundary_edges = sum(1 for e in bm.edges if len(e.link_faces) != 2)
        result["secondary_analysis"]["is_watertight"] = boundary_edges == 0

        # Intersecting faces (skip for very large meshes to avoid timeout)
        if len(bm.faces) < 50000:
            try:
                tree = mathutils.bvhtree.BVHTree.FromBMesh(bm, epsilon=0.00001)
                overlap = tree.overlap(tree)
                result["secondary_analysis"]["has_intersecting_faces"] = bool(overlap)
            except Exception:
                pass

        # Normal analysis
        if len(bm.faces) > 0:
            result["secondary_analysis"]["normal_analysis"]["has_normals"] = True
            center = sum((v.co for v in bm.verts), mathutils.Vector()) / len(bm.verts)
            outward_count = sum(1 for f in bm.faces if f.normal.dot(center - f.calc_center_median()) <= 0)
            result["secondary_analysis"]["normal_analysis"]["all_normals_outward"] = outward_count == len(bm.faces)

        # Smooth shading
        result["secondary_analysis"]["is_smooth"] = all(e.smooth for e in bm.edges)

        # Face area distribution
        if len(bm.faces) > 0:
            areas = [f.calc_area() for f in bm.faces]
            avg_area = float(np.mean(areas))
            threshold = avg_area * 0.25
            has_uneven = any(a > avg_area + threshold or a < avg_area - threshold for a in areas[:1000])
            result["secondary_analysis"]["surface_area_analysis"] = {
                "has_uneven_areas": has_uneven,
                "average_area": avg_area,
            }

        bm.free()
    except Exception as e:
        logger.warning(f"Analysis failed for {mesh_obj.name}: {e}")

    return result


def analyze_scene():
    """Analyze the entire loaded bpy scene. Returns aggregate + per-mesh results."""
    scene_name = bpy.path.basename(bpy.data.filepath) or "scene"

    meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH']
    lights = [obj for obj in bpy.data.objects if obj.type == 'LIGHT']
    cameras_obj = [obj for obj in bpy.data.objects if obj.type == 'CAMERA']

    # Scene bounds
    from mathutils import Vector
    min_co = Vector((float("inf"),) * 3)
    max_co = Vector((float("-inf"),) * 3)
    for obj in meshes:
        bbox = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
        for co in bbox:
            min_co.x = min(min_co.x, co.x)
            min_co.y = min(min_co.y, co.y)
            min_co.z = min(min_co.z, co.z)
            max_co.x = max(max_co.x, co.x)
            max_co.y = max(max_co.y, co.y)
            max_co.z = max(max_co.z, co.z)

    # Per-mesh analysis
    per_mesh = []
    total_verts = 0
    total_faces = 0
    total_materials = set()
    materials_with_principled = 0
    all_texture_types = set()
    has_uv = False
    watertight_count = 0
    intersecting_count = 0

    for i, obj in enumerate(meshes):
        if i % 50 == 0:
            logger.info(f"Analyzing mesh {i + 1}/{len(meshes)}: {obj.name}")

        analysis = analyze_mesh(obj)
        per_mesh.append(analysis)

        p = analysis["primary_analysis"]
        s = analysis["secondary_analysis"]
        pbr = analysis["pbr_analysis"]

        total_verts += p["vertex_count"]
        total_faces += p["face_count"]
        if p["has_uv_maps"]:
            has_uv = True
        if s["is_watertight"]:
            watertight_count += 1
        if s["has_intersecting_faces"]:
            intersecting_count += 1
        if pbr.get("pbr_details", {}).get("materials_with_principled", 0) > 0:
            materials_with_principled += pbr["pbr_details"]["materials_with_principled"]
        for tex_type in pbr.get("pbr_details", {}).get("texture_types_found", []):
            all_texture_types.add(tex_type)

        for mat in obj.data.materials:
            if mat:
                total_materials.add(mat.name)

    return {
        "scene_name": scene_name,
        "total_objects": len(bpy.data.objects),
        "total_meshes": len(meshes),
        "total_lights": len(lights),
        "total_cameras": len(cameras_obj),
        "scene_bounds": {
            "min": [float(min_co.x), float(min_co.y), float(min_co.z)],
            "max": [float(max_co.x), float(max_co.y), float(max_co.z)],
            "dimensions": [float(max_co.x - min_co.x), float(max_co.y - min_co.y), float(max_co.z - min_co.z)],
        },
        "aggregate": {
            "total_vertices": total_verts,
            "total_faces": total_faces,
            "total_materials": len(total_materials),
            "materials_with_principled_bsdf": materials_with_principled,
            "pbr_texture_types_found": sorted(list(all_texture_types)),
            "has_uv_maps": has_uv,
            "mesh_parts_total": len(meshes),
            "watertight_meshes": watertight_count,
            "meshes_with_intersecting_faces": intersecting_count,
        },
        "per_mesh": per_mesh,
    }
