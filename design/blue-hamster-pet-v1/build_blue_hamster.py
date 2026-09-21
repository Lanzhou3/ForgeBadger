"""Build the approved silver-blue technology hamster from scratch in Blender.

Run in a separate Blender background process, never in an existing user scene.
No previous hamster models or geometry scripts are read. The approved image is
packed as a reference only; all visible geometry, fur and materials are editable.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
import time

import bpy
import numpy as np
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
PARSER = argparse.ArgumentParser()
PARSER.add_argument("--preview", action="store_true")
PARSER.add_argument("--render-only", action="store_true")
ARGS = PARSER.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
RNG = np.random.default_rng(92026)
START = time.time()
HAIR_COUNTS = {}


def log(message):
    print(f"[Blue hamster {time.time() - START:.1f}s] {message}", flush=True)


def linear(rgb):
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)


def material(name, color, roughness=.4, metallic=0.0, subsurface=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*linear(color), 1)
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = mat.diffuse_color
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Metallic"].default_value = metallic
    node.inputs["Subsurface Weight"].default_value = subsurface
    if subsurface:
        node.inputs["Subsurface Radius"].default_value = (1, .38, .24)
        node.inputs["Subsurface Scale"].default_value = .07
    return mat


def emit_material(name, color, strength):
    mat = material(name, color, .22, .12)
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Emission Color"].default_value = (*linear(color), 1)
    node.inputs["Emission Strength"].default_value = strength
    return mat


def assign(obj, mat):
    obj.data.materials.append(mat)
    return obj


def move_collection(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


def smooth(obj):
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def apply_transform(obj):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def uv(name, location, scale, mat, collection, rotation=(0, 0, 0), segments=48, rings=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.rotation_euler = rotation
    apply_transform(obj)
    assign(obj, mat)
    smooth(obj)
    return move_collection(obj, collection)


def mesh(name, vertices, faces, mat, collection):
    data = bpy.data.meshes.new(name + " mesh")
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    assign(obj, mat)
    return smooth(obj)


def curve(name, points, radius, mat, collection, cyclic=False):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 16
    data.bevel_depth = radius
    data.bevel_resolution = 3
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, xyz in zip(spline.bezier_points, points):
        point.co = xyz
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    assign(obj, mat)
    return obj


def cube(name, location, scale, mat, collection, bevel=.03):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    apply_transform(obj)
    assign(obj, mat)
    mod = obj.modifiers.new("Soft manufactured edges", "BEVEL")
    mod.width = bevel
    mod.segments = 4
    obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    return move_collection(obj, collection)


def fused(name, parts, mat, collection, voxel=.027):
    objects = [uv(name + " sculpt volume", p, s, mat, collection) for p, s in parts]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = objects[0]
    obj.name = name
    mod = obj.modifiers.new("Continuous organic sculpt", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = voxel
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = obj.modifiers.new("Soften sculpt transitions", "SMOOTH")
    mod.factor = 1.0
    mod.iterations = 5
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = obj.modifiers.new("Sculpt surface subdivision", "SUBSURF")
    mod.levels = 1
    bpy.ops.object.modifier_apply(modifier=mod.name)
    smooth(obj)
    return obj


def new_collection(name):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def parent_keep(obj, parent):
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


def new_empty(name, location, collection):
    obj = bpy.data.objects.new(name, None)
    collection.objects.link(obj)
    obj.location = location
    obj.empty_display_size = .2
    return obj


def fur_material():
    mat = bpy.data.materials.new("Fur | silver mist, per-strand color")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    hair = nodes.new("ShaderNodeBsdfHairPrincipled")
    hair.parametrization = "COLOR"
    hair.inputs["Roughness"].default_value = .46
    hair.inputs["Radial Roughness"].default_value = .54
    hair.inputs["Random Roughness"].default_value = .12
    tint = nodes.new("ShaderNodeAttribute")
    tint.attribute_name = "fur_color"
    mat.node_tree.links.new(tint.outputs["Color"], hair.inputs["Color"])
    mat.node_tree.links.new(hair.outputs[0], out.inputs["Surface"])
    mat.diffuse_color = (*linear((.79, .82, .86)), 1)
    return mat


def normalize(array):
    return array / np.maximum(np.linalg.norm(array, axis=1, keepdims=True), 1e-8)


def fur(obj, count, length, region, collection, mat):
    """Sample the real sculpt surface; editable native Hair Curves, no cards."""
    obj.data.calc_loop_triangles()
    vertices = np.array([v.co[:] for v in obj.data.vertices], dtype=np.float32)
    normals = np.array([v.normal[:] for v in obj.data.vertices], dtype=np.float32)
    indices = np.array([t.vertices[:] for t in obj.data.loop_triangles])
    triangles = vertices[indices]
    area = np.linalg.norm(np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]), axis=1)
    selected = RNG.choice(len(triangles), count, p=area.astype(float) / area.astype(float).sum())
    sample = RNG.random((count, 2))
    sample[sample.sum(axis=1) > 1] = 1 - sample[sample.sum(axis=1) > 1]
    bary = np.column_stack((1 - sample.sum(axis=1), sample))
    roots = np.einsum("ni,nij->nj", bary, triangles[selected])
    norms = normalize(np.einsum("ni,nij->nj", bary, normals[indices[selected]]))
    keep = np.ones(count, dtype=bool)
    if region == "head":
        for sign in (-1, 1):
            eye = ((roots[:, 0] - sign * .42) / .137) ** 2 + ((roots[:, 2] - 2.86) / .165) ** 2
            keep &= ~((eye < 1.02) & (roots[:, 1] < -.62))
        keep &= ~((np.abs(roots[:, 0]) < .11) & (roots[:, 1] < -.98) & (np.abs(roots[:, 2] - 2.51) < .095))
    if region == "body":
        theta = np.abs(np.arctan2(roots[:, 0] / 1.03, -(roots[:, 1] - .1) / .77))
        z = roots[:, 2]
        front_edge = .38 + .14 * np.clip((z - 1.20) / .965, 0, 1)
        under_vest = (z > 1.20) & (z < 2.18) & (theta > front_edge)
        keep &= ~under_vest
    if region == "ear":
        sign = 1 if roots[:, 0].mean() > 0 else -1
        x, z = roots[:, 0] - sign * .80, roots[:, 2] - 3.36
        angle = -sign * .28
        local_x = x * math.cos(angle) - z * math.sin(angle)
        local_z = x * math.sin(angle) + z * math.cos(angle)
        keep &= (local_x / .245) ** 2 + (local_z / .31) ** 2 > .78 ** 2
    roots, norms = roots[keep], norms[keep]
    count = len(roots)
    strand_length = RNG.uniform(.65, 1.25, count) * length
    comb = np.zeros_like(roots)
    comb[:, 2] = -.8
    if region == "head":
        comb[:, 0] = roots[:, 0] * 1.25
        comb[:, 2] = -.34 + (roots[:, 2] - 2.6) * .28
        front = roots[:, 1] < -.7
        near_muzzle = front & (np.abs(roots[:, 0]) < .4) & (roots[:, 2] < 2.7)
        strand_length[near_muzzle] *= .55
        strand_length[(roots[:, 2] > 2.72) & front] *= .68
    if region == "ear":
        strand_length *= .50
    tangent = normalize(comb - norms * np.sum(comb * norms, axis=1)[:, None])
    wobble = normalize(RNG.normal(size=roots.shape))
    t = np.linspace(0, 1, 5, dtype=np.float32)
    positions = roots[:, None, :] + norms[:, None, :] * .002
    positions = positions + strand_length[:, None, None] * (
        norms[:, None, :] * (t - .45 * t * t)[None, :, None]
        + tangent[:, None, :] * (.85 * t * t)[None, :, None]
        + wobble[:, None, :] * (.065 * np.sin(t * math.pi))[None, :, None]
    )
    data = bpy.data.hair_curves.new(obj.name + " | groom")
    data.add_curves([5] * count)
    data.attributes["position"].data.foreach_set("vector", positions.astype(np.float32).reshape(-1))
    radius = data.attributes.new("radius", "FLOAT", "POINT")
    root_width = RNG.uniform(.00095, .0017, count)
    widths = root_width[:, None] * np.array([.95, 1, .77, .42, .035])[None, :]
    radius.data.foreach_set("value", widths.astype(np.float32).reshape(-1))
    base = np.tile(np.array(linear((.73, .775, .815))), (count, 1))
    pearl = np.array(linear((.925, .918, .90)))
    frontness = np.clip((-roots[:, 1] - .1) / .75, 0, 1)
    if region == "head":
        pale = frontness * np.clip((3.02 - roots[:, 2]) / .60, 0, 1)
    else:
        pale = frontness * np.clip(1 - np.abs(roots[:, 0]) / .85, 0, 1)
    base = base * (1 - pale[:, None]) + pearl[None, :] * pale[:, None]
    base *= RNG.uniform(.88, 1.05, (count, 1))
    rgba = np.concatenate((np.clip(base, 0, 1), np.ones((count, 1))), axis=1)
    colors = data.attributes.new("fur_color", "FLOAT_COLOR", "POINT")
    colors.data.foreach_set("color", np.repeat(rgba, 5, axis=0).astype(np.float32).reshape(-1))
    groom = bpy.data.objects.new(obj.name + " | short fur", data)
    collection.objects.link(groom)
    assign(groom, mat)
    HAIR_COUNTS[obj.name] = count
    log(f"Groomed {obj.name}: {count:,} strands")
    return groom


def ear(sign, col, coat, skin):
    center = Vector((sign * .80, -.055, 3.36))
    angle = -sign * .28
    def p(r, a, front=False):
        x, z = .245 * r * math.cos(a), .31 * r * math.sin(a)
        return center + Vector((x * math.cos(angle) + z * math.sin(angle),
                                -.065 + .125 * (1 - r * r) - (.009 if front else 0),
                                -x * math.sin(angle) + z * math.cos(angle)))
    def shell(name, maxr, mat, front):
        verts = [p(0, 0, front)]
        for i in range(1, 13):
            for j in range(64):
                verts.append(p(maxr * i / 12, j * math.tau / 64, front))
        faces = [(0, 1 + j, 1 + (j + 1) % 64) for j in range(64)]
        for i in range(11):
            for j in range(64):
                a, b = 1 + i * 64 + j, 1 + i * 64 + (j + 1) % 64
                faces.append((a, a + 64, b + 64, b))
        obj = mesh(name, verts, faces, mat, col)
        solid = obj.modifiers.new("Soft ear thickness", "SOLIDIFY")
        solid.thickness = .028 if not front else .002
        return obj
    outer = shell(f"Ear {'L' if sign < 0 else 'R'} | cupped cartilage", 1, coat, False)
    shell(f"Ear {'L' if sign < 0 else 'R'} | translucent inner skin", .90, skin, True)
    return outer


def vest_surface(sign, theta, z):
    radial = math.sqrt(max(.08, 1 - ((z - 1.29) / 1.20) ** 2))
    return (sign * (1.035 * radial + .031) * math.sin(theta),
            .10 - (.77 * radial + .035) * math.cos(theta), z)


def make_vest(col, textile, trim, cyan):
    for sign in (-1, 1):
        rows, cols = 30, 48
        vertices = []
        for iz in range(rows + 1):
            v = iz / rows
            for it in range(cols + 1):
                u = it / cols
                z = 1.20 + .965 * v + .06 * math.sin(u * math.pi) * (1 - v)
                front = .38 + .14 * v
                theta = front + (math.pi - front) * u
                vertices.append(vest_surface(sign, theta, z))
        faces = []
        for iz in range(rows):
            for it in range(cols):
                a = iz * (cols + 1) + it
                face = (a, a + 1, a + cols + 2, a + cols + 1)
                faces.append(face if sign > 0 else face[::-1])
        panel = mesh(f"Vest {'L' if sign < 0 else 'R'} | tailored shell", vertices, faces, textile, col)
        solid = panel.modifiers.new("Padded textile thickness", "SOLIDIFY")
        solid.thickness = .027
        bevel = panel.modifiers.new("Soft tailored edge", "BEVEL")
        bevel.width = .025
        bevel.segments = 3
        edge = [vest_surface(sign, .38 + .14 * v, 1.20 + .965 * v) for v in np.linspace(0, 1, 18)]
        curve(f"Vest {sign} | front binding", edge, .022, trim, col)
        lower = [vertices[j] for j in range(cols + 1)]
        curve(f"Vest {sign} | hem binding", lower, .018, trim, col)
        upper = vertices[-(cols + 1):]
        curve(f"Vest {sign} | soft collar binding", upper, .021, trim, col)
        luminous = []
        bezel = []
        for z in np.linspace(1.75, 2.10, 8):
            theta = .38 + .14 * (z - 1.20) / .965 + .082
            point = Vector(vest_surface(sign, theta, z))
            point.y -= .026
            bezel.append(point)
            luminous.append(point + Vector((0, -.039, 0)))
        curve(f"Vest {sign} | light channel", bezel, .037, trim, col)
        curve(f"Vest {sign} | cyan light strip", luminous, .017, cyan, col)
        # A narrow visible stitched line, sewn into the fabric rather than floating.
        for i, z in enumerate(np.linspace(1.27, 1.73, 22)):
            th = .38 + .14 * (z - 1.20) / .965 + .060
            p = Vector(vest_surface(sign, th, z)) + Vector((0, -.012, 0))
            curve(f"Vest {sign} | stitch {i:02}", [p, p + Vector((0, 0, .012))], .0028, SEAM, col)


def goggles(col, glass, metal, cyan):
    def bounds(x):
        u = abs(x) / .79
        return 3.055 + .135 * math.exp(-(x / .25) ** 2) + .075 * u ** 3, 3.465 - .305 * u ** 1.8
    def p(x, v):
        low, high = bounds(x)
        z = low * (1 - v) + high * v
        return (x, -.690 + .40 * (abs(x) / .83) ** 2 + .13 * (z - 3.18), z)
    nx, ny = 80, 12
    verts = [p(-.79 + 1.58 * ix / nx, iy / ny) for iy in range(ny + 1) for ix in range(nx + 1)]
    faces = []
    for iy in range(ny):
        for ix in range(nx):
            a = iy * (nx + 1) + ix
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    lens = mesh("Goggles | continuous curved transparent lens", verts, faces, glass, col)
    solid = lens.modifiers.new("Optical lens thickness", "SOLIDIFY")
    solid.thickness = .010
    boundary = [p(x, 0) for x in np.linspace(-.79, .79, 25)]
    boundary += [p(x, 1) for x in np.linspace(.79, -.79, 25)]
    curve("Goggles | titanium rim", boundary, .024, metal, col, True)
    glowline = [Vector(point) + Vector((0, -.023, 0)) for point in boundary]
    curve("Goggles | fine cyan optical rim", glowline, .007, cyan, col, True)
    for sign in (-1, 1):
        cube(f"Goggles {sign} | hinge", (sign * .795, -.275, 3.15), (.09, .14, .12), metal, col, .025)
        curve(f"Goggles {sign} | temple arm", [(sign * .79, -.28, 3.16), (sign * .95, -.07, 3.13),
               (sign * .97, .19, 3.07), (sign * .90, .38, 2.99)], .035, metal, col)
        for x in (.44, .63):
            a = Vector(p(sign * x, 1)) + Vector((0, -.038, -.028))
            uv(f"Goggles {sign} | status dot {x}", a, (.021, .007, .012), cyan, col, segments=20, rings=12)


def digits(sign, col, skin, nail):
    uv(f"Hand {sign} | palm", (sign * .275, -.855, 1.59), (.094, .058, .082), skin, col)
    for i in range(4):
        x = sign * (.207 + i * .039)
        z = 1.59 - .009 * i
        path = [(x, -.890, z), (x - sign * .024, -.923, z - .032), (x - sign * .035, -.918, z - .080 + .009 * i)]
        curve(f"Hand {sign} | finger {i+1}", path, .018 - i * .0010, skin, col)
        end = Vector(path[-1]) + Vector((0, -.012, .005))
        uv(f"Hand {sign} | nail {i+1}", end, (.011, .006, .013), nail, col, segments=16, rings=12)
    curve(f"Hand {sign} | thumb", [(sign * .35, -.86, 1.61), (sign * .355, -.92, 1.58),
                                  (sign * .335, -.928, 1.56)], .021, skin, col)


def forearm(sign, col, coat):
    """One smoothly tapered bent limb, with no intersecting shoulder blobs."""
    a = Vector((sign * .75, -.30, 1.91))
    b = Vector((sign * .91, -.55, 1.56))
    c = Vector((sign * .34, -.78, 1.61))
    verts, faces = [], []
    rows, sections = 44, 32
    for i in range(rows + 1):
        t = i / rows
        center = (1-t)**2 * a + 2*t*(1-t)*b + t*t*c
        tangent = (2*(1-t)*(b-a) + 2*t*(c-b)).normalized()
        basis_u = tangent.cross(Vector((0, 1, 0))).normalized()
        basis_v = tangent.cross(basis_u).normalized()
        radius = (.185 - .085 * t) * max(.05, math.sin(math.pi * (.03 + .94*t)) ** .23)
        for j in range(sections):
            angle = j * math.tau / sections
            verts.append(center + radius * (math.cos(angle)*basis_u + math.sin(angle)*basis_v))
    for i in range(rows):
        for j in range(sections):
            aidx = i*sections+j
            bidx = i*sections+(j+1)%sections
            faces.append((aidx, bidx, bidx+sections, aidx+sections))
    faces.append(tuple(range(sections-1, -1, -1)))
    faces.append(tuple(rows*sections+j for j in range(sections)))
    return mesh(f"Forearm {sign} | continuous tapered bent limb", verts, faces, coat, col)


def foot(sign, col, skin, nail):
    uv(f"Foot {sign} | instep", (sign * .52, -.30, .11), (.17, .29, .085), skin, col)
    for i in range(4):
        x = sign * (.405 + i * .071)
        length = .16 - .021 * abs(i - 1.5)
        end = (x + sign * .016, -.52 - length, .065)
        curve(f"Foot {sign} | toe {i+1}", [(x, -.46, .09), (x, -.56, .08), end], .028 - .002 * abs(i - 1), skin, col)
        uv(f"Foot {sign} | nail {i+1}", (end[0], end[1] - .005, .077), (.017, .022, .009), nail, col, segments=20, rings=12)


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def area(name, location, energy, color, size, collection, target=(0, 0, 2)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    if name != "Studio | large soft key":
        data.specular_factor = .12
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    look_at(obj, target)
    return obj


def render(scene, camera, name, location, size, transparent=False, samples=64):
    camera.location = location
    look_at(camera, (0, -.02, 1.87))
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = transparent
    scene.cycles.samples = samples
    scene.render.filepath = str(ROOT / name)
    bpy.data.objects["Studio | floor"].hide_render = transparent
    log(f"Rendering {name} {size}, {samples} samples")
    bpy.ops.render.render(write_still=True)


if not ARGS.render_only:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for data in list(bpy.data.collections):
        bpy.data.collections.remove(data)
    body_col = new_collection("01 | Silhouette and paws")
    face_col = new_collection("02 | Face, cupped ears and whiskers")
    fur_col = new_collection("03 | Native editable fur curves")
    vest_col = new_collection("04 | Tailored technology vest")
    optics_col = new_collection("05 | Raised AR goggles")
    control_col = new_collection("06 | Pose roots and reference")
    studio_col = new_collection("07 | Studio and cameras")

    COAT = material("Coat base | pale blue silver", (.75, .79, .83), .7, subsurface=.04)
    PEARL = material("Muzzle base | pearl white", (.88, .88, .86), .65, subsurface=.05)
    SKIN = material("Skin | warm shell pink", (.83, .52, .49), .46, subsurface=.23)
    EAR_SKIN = material("Ear interior | translucent blush", (.67, .41, .40), .53, subsurface=.28)
    NAIL = material("Tiny translucent claws", (.86, .72, .66), .3, subsurface=.10)
    NOSE = material("Nose | soft rose", (.79, .38, .39), .37, subsurface=.2)
    LIP = material("Nose crease and mouth", (.32, .16, .15), .52)
    EYE = material("Eyes | deep brown black glossy", (.030, .023, .020), .16)
    EYE.node_tree.nodes.get("Principled BSDF").inputs["Coat Weight"].default_value = .23
    LID = material("Fine eyelid | warm gray", (.27, .23, .23), .48)
    TEXTILE = material("Vest | woven graphite technical fabric", (.16, .18, .20), .79)
    nodes = TEXTILE.node_tree.nodes
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 240
    noise.inputs["Detail"].default_value = 2
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = .32
    bump.inputs["Distance"].default_value = .008
    TEXTILE.node_tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    TEXTILE.node_tree.links.new(bump.outputs["Normal"], nodes.get("Principled BSDF").inputs["Normal"])
    TRIM = material("Vest | rubberized edge binding", (.075, .095, .12), .6)
    SEAM = material("Vest | charcoal thread", (.30, .32, .34), .8)
    METAL = material("Goggles | satin titanium graphite", (.19, .24, .31), .27, .72)
    CYAN = emit_material("Cyan | restrained optical light", (.15, .76, 1.0), 3.0)
    WHISKER = material("Whiskers | translucent pearl", (.80, .82, .84), .36)
    GLASS = material("Goggles | clear blue optical polymer", (.44, .73, .91), .09)
    glass_node = GLASS.node_tree.nodes.get("Principled BSDF")
    glass_node.inputs["Transmission Weight"].default_value = 1.0
    glass_node.inputs["IOR"].default_value = 1.40
    transparent = GLASS.node_tree.nodes.new("ShaderNodeBsdfTransparent")
    mix = GLASS.node_tree.nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = .15
    GLASS.node_tree.links.new(glass_node.outputs[0], mix.inputs[1])
    GLASS.node_tree.links.new(transparent.outputs[0], mix.inputs[2])
    GLASS.node_tree.links.new(mix.outputs[0], GLASS.node_tree.nodes.get("Material Output").inputs["Surface"])
    FUR = fur_material()

    root = new_empty("PET ROOT | Blue Syrian hamster", (0, 0, 0), control_col)
    head_root = new_empty("HEAD | gentle curious tilt", (0, -.12, 2.62), control_col)
    parent_keep(head_root, root)
    body = fused("Body | continuous rounded pear sculpt", [((0, .10, 1.29), (1.035, .77, 1.20)),
                 ((0, -.12, .78), (.88, .70, .72))], COAT, body_col)
    head = fused("Head | natural integrated cheeks and muzzle", [((0, -.12, 2.72), (1.015, .73, .83)),
                 ((-.39, -.43, 2.49), (.48, .43, .335)), ((.39, -.43, 2.49), (.48, .43, .335)),
                 ((-.125, -.87, 2.61), (.235, .22, .155)),
                 ((.125, -.87, 2.61), (.235, .22, .155))], COAT, face_col, .021)
    fur(body, 135000, .062, "body", fur_col, FUR)
    head_fur = fur(head, 115000, .060, "head", fur_col, FUR)
    head_parts = [head, head_fur]
    for sign in (-1, 1):
        prev_face = set(face_col.objects)
        outer_ear = ear(sign, face_col, COAT, EAR_SKIN)
        head_parts.append(fur(outer_ear, 7500, .024, "ear", fur_col, FUR))
        eye = uv(f"Eye {sign} | glossy organic eyeball", (sign * .42, -.808, 2.86), (.129, .081, .155), EYE, face_col)
        ring = [(sign * .42 + .132 * math.cos(t), -.801 - .012 * math.sin(t), 2.86 + .157 * math.sin(t))
                for t in np.linspace(0, math.tau, 36, endpoint=False)]
        curve(f"Eye {sign} | fine natural eyelid", ring, .006, LID, face_col, True)
        head_parts.extend(set(face_col.objects) - prev_face)
        arm = forearm(sign, body_col, COAT)
        fur(arm, 18000, .048, "arm", fur_col, FUR)
        digits(sign, body_col, SKIN, NAIL)
        foot(sign, body_col, SKIN, NAIL)

    previous_face = set(face_col.objects)
    nose = uv("Nose | rounded triangular pink nose", (0, -1.012, 2.55), (.097, .062, .065), NOSE, face_col)
    for v in nose.data.vertices:
        t = (v.co.z - 2.55) / .065
        v.co.x *= .73 + .30 * (t + 1) / 2
    for sign in (-1, 1):
        curve(f"Nose {sign} | nostril fold", [(sign * .052, -1.065, 2.55), (sign * .049, -1.070, 2.535),
              (sign * .036, -1.065, 2.528)], .004, LIP, face_col)
        curve(f"Muzzle {sign} | delicate mouth", [(0, -.989, 2.472), (sign * .045, -.974, 2.452),
              (sign * .09, -.961, 2.460)], .004, LIP, face_col)
        for i in range(7):
            z = 2.47 + (i - 3) * .024
            root_point = Vector((sign * (.19 + .014 * (i % 2)), -.980, z + .04))
            end = Vector((sign * (1.00 + .07 * (i % 3)), -.81 + .07 * (i % 2), z + (i - 3) * .088))
            whisker = curve(f"Whisker {sign} | {i+1}", [root_point, root_point.lerp(end, .46) + Vector((0, -.055, .025)), end], .0028, WHISKER, face_col)
            for j, point in enumerate(whisker.data.splines[0].bezier_points):
                point.radius = [1, .7, .035][j]
    curve("Muzzle | philtrum", [(0, -1.048, 2.512), (0, -1.010, 2.48), (0, -.989, 2.470)], .004, LIP, face_col)
    head_parts.extend(set(face_col.objects) - previous_face)
    for obj in set(face_col.objects) - previous_face:
        obj.location.y -= .09
        obj.location.z += .09
    make_vest(vest_col, TEXTILE, TRIM, CYAN)
    goggles(optics_col, GLASS, METAL, CYAN)
    for obj in optics_col.objects:
        obj.location.y -= .16
        obj.location.z += .07
    bpy.context.view_layer.update()
    head_parts.extend(list(optics_col.objects))
    for obj in head_parts:
        parent_keep(obj, head_root)
    for col in (body_col, fur_col, vest_col):
        for obj in col.objects:
            if obj.parent is None:
                parent_keep(obj, root)
    head_root.rotation_euler[1] = math.radians(-5)

    # Pack the approved image into the .blend, but do not use it on geometry.
    ref = bpy.data.images.load(str(ROOT / "reference.png"))
    ref.pack()
    ref.use_fake_user = True
    root["reference"] = "reference.png — user-approved silver-blue concept"
    root["construction"] = "Original editable sculpt meshes and native 3D hair curves. No earlier hamster assets."
    root["stage"] = "Static look-development asset; not rigged or integrated into the application."

    floor_mat = material("Studio | charcoal matte", (.19, .20, .23), .84)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.015))
    floor = bpy.context.object
    floor.name = "Studio | floor"
    assign(floor, floor_mat)
    move_collection(floor, studio_col)
    area("Studio | large soft key", (-3.6, -4.5, 6.5), 500, (1, .94, .88), 4.2, studio_col)
    area("Studio | frontal fill", (3.5, -4, 3.8), 220, (.86, .92, 1), 3.5, studio_col)
    area("Studio | cool contour", (2.8, 2.8, 5.4), 750, (.70, .84, 1), 3.1, studio_col)
    area("Studio | overhead softness", (-2, 1, 6.5), 360, (1, .98, .95), 3.0, studio_col)
    camera_data = bpy.data.cameras.new("Camera | portrait")
    camera = bpy.data.objects.new("Camera | portrait", camera_data)
    studio_col.objects.link(camera)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 4.45
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = True
    scene.cycles.adaptive_threshold = .025
    scene.cycles.max_bounces = 10
    scene.cycles.transmission_bounces = 8
    scene.cycles.transparent_max_bounces = 12
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.get("Background").inputs[0].default_value = (.18, .20, .25, 1)
    scene.world.node_tree.nodes.get("Background").inputs[1].default_value = .16
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.resolution_x = scene.render.resolution_y = 1200
    camera.location = (2.8, -11, 3.75)
    look_at(camera, (0, -.02, 1.87))
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    for screen in bpy.data.screens:
        for area_ui in screen.areas:
            if area_ui.type == "VIEW_3D":
                area_ui.spaces.active.region_3d.view_perspective = "CAMERA"
                area_ui.spaces.active.shading.type = "MATERIAL"
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "blue-hamster.blend"))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    metadata = {"blender": bpy.app.version_string, "reference": "reference.png", "hair_strands": HAIR_COUNTS,
                "total_hair_strands": sum(HAIR_COUNTS.values()), "mesh_objects": len(meshes),
                "mesh_vertices": sum(len(o.data.vertices) for o in meshes),
                "native_hair_objects": len([o for o in bpy.data.objects if o.type == "CURVES"]),
                "rigged": False, "runtime_integrated": False}
    (ROOT / "model-info.json").write_text(json.dumps(metadata, indent=2) + "\n")
    log("Saved editable Blender asset")
else:
    scene = bpy.context.scene
    camera = scene.camera

if ARGS.preview:
    render(scene, camera, "preview.png", (2.8, -11, 3.75), (768, 768), samples=32)
else:
    render(scene, camera, "hero.png", (2.8, -11, 3.75), (1200, 1200), samples=96)
    render(scene, camera, "front.png", (0, -11, 3.45), (1000, 1100), samples=80)
    render(scene, camera, "rear.png", (4.2, 9, 3.8), (1000, 1100), samples=80)
    render(scene, camera, "pet-transparent.png", (2.8, -11, 3.75), (1024, 1024), transparent=True, samples=96)
log("Done")
