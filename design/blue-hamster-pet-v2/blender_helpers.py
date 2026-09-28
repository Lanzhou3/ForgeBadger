"""Generic Blender geometry/material utilities; no character geometry or assets."""

import math
import bpy
import numpy as np
from mathutils import Vector

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
    data.use_fill_caps = True
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
