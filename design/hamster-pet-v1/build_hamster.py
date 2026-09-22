"""Create the H-02 cream hamster in a separate Blender background process."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
model = bpy.data.collections.new('H-02 | Cream tech hamster')
scene.collection.children.link(model)
studio = bpy.data.collections.new('Studio | excluded from GLB')
scene.collection.children.link(studio)


def move(obj, collection):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


def material(name, color, rough=.4, metal=0, glow=0, fur=False):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    if glow:
        bs.inputs['Emission Color'].default_value = (*color, 1)
        bs.inputs['Emission Strength'].default_value = glow
    if fur:
        bs.inputs['Sheen Weight'].default_value = .35
        bs.inputs['Subsurface Weight'].default_value = .045
        noise = m.node_tree.nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 180
        noise.inputs['Detail'].default_value = 2
        bump = m.node_tree.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .22
        bump.inputs['Distance'].default_value = .025
        m.node_tree.links.new(noise.outputs['Fac'], bump.inputs['Height'])
        m.node_tree.links.new(bump.outputs['Normal'], bs.inputs['Normal'])
    return m


cream = material('Fur | warm oat cream', (.67, .48, .28), .76, fur=True)
light = material('Fur | vanilla cheeks and belly', (.91, .76, .53), .78, fur=True)
tuft = material('Fur | honey crown', (.49, .32, .16), .8, fur=True)
pink = material('Skin | rose petal', (.68, .30, .27), .53)
earpink = material('Ear | soft blush', (.50, .23, .20), .7)
eye = material('Eyes | obsidian', (.009, .006, .004), .115)
nosemat = material('Nose | soft pink', (.72, .26, .24), .38)
mouthmat = material('Mouth | cocoa', (.16, .062, .031), .72)
whisker = material('Whiskers | cream', (.71, .60, .43), .65)
navy = material('Equipment | deep teal rubber', (.018, .075, .085), .42)
metal = material('Equipment | brushed titanium', (.16, .25, .27), .32, .7)
shell = material('Equipment | warm ceramic', (.70, .79, .72), .3, .18)
cyan = material('Signal | aqua', (.018, .65, .58), .25, .15, 2.1)
amber = material('Signal | amber', (.95, .30, .035), .3, .2, 1.2)
floor = material('Studio | midnight teal', (.013, .031, .037), .64)

root = bpy.data.objects.new('H02_ROOT', None)
model.objects.link(root)


def group(name, pos, parent=root):
    obj = bpy.data.objects.new(name, None)
    model.objects.link(obj)
    obj.location = pos
    obj.parent = parent
    return obj


def finish(obj, name, mat, parent=root, collection=model):
    obj.name = name
    move(obj, collection)
    obj.data.materials.append(mat)
    if parent:
        bpy.context.view_layer.update()
        matrix = obj.matrix_world.copy()
        obj.parent = parent
        obj.matrix_world = matrix
    return obj


def sphere(name, pos, scale, mat, parent=root):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, location=pos)
    obj = bpy.context.object
    obj.scale = scale
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return finish(obj, name, mat, parent)


def box(name, pos, size, mat, radius=.08, parent=root):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new('Rounded edges', 'BEVEL')
    bevel.width = radius
    bevel.segments = 5
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    normal = obj.modifiers.new('Corner normals', 'WEIGHTED_NORMAL')
    bpy.ops.object.modifier_apply(modifier=normal.name)
    return finish(obj, name, mat, parent)


def line(name, points, radius, mat, parent=root):
    bpy.ops.object.select_all(action='DESELECT')
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 16
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for point, coord in zip(spline.bezier_points, points):
        point.co = coord
        point.handle_left_type = 'AUTO'
        point.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, curve)
    model.objects.link(obj)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return finish(bpy.context.object, name, mat, parent)


def cylinder(name, start, end, radius, mat, parent=root):
    a, b = Vector(start), Vector(end)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=radius, depth=(b-a).length, location=(a+b)/2)
    obj = bpy.context.object
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    bevel = obj.modifiers.new('Soft rim', 'BEVEL')
    bevel.width = .016
    bevel.segments = 3
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return finish(obj, name, mat, parent)


body = group('Body_PIVOT', (0, 0, 1.0))
sphere('Body | pear silhouette', (0, .10, 1.0), (.80, .63, .96), cream, body)
sphere('Belly | vanilla bib', (0, -.423, .91), (.57, .22, .70), light, body)
head = group('Head_PIVOT', (0, -.04, 2.08))
sphere('Head | round cheek silhouette', (0, -.04, 2.02), (.98, .68, .81), cream, head)
for side in [-1, 1]:
    ear = sphere('Ear | outer '+str(side), (side*.65, .025, 2.69), (.285, .145, .36), cream, head)
    ear.rotation_euler.y = side*.23
    inner = sphere('Ear | inner '+str(side), (side*.65, -.103, 2.71), (.196, .036, .247), earpink, head)
    inner.rotation_euler.y = side*.23
    sphere('Cheek | pouch '+str(side), (side*.50, -.48, 1.87), (.44, .29, .35), light, head)
    sphere('Eye | soft socket '+str(side), (side*.40, -.620, 2.20), (.178, .075, .219), cream, head)
    orb = sphere('Eye | glossy '+str(side), (side*.41, -.677, 2.205), (.116, .077, .155), eye, head)
    orb.rotation_euler.z = side*.12
    sphere('Muzzle | '+str(side), (side*.145, -.678, 1.87), (.238, .20, .179), light, head)

sphere('Nose | pink button', (0, -.868, 1.963), (.116, .064, .076), nosemat, head)
line('Mouth | philtrum', [(0, -.845, 1.917), (0, -.852, 1.855)], .010, mouthmat, head)
for side in [-1, 1]:
    line('Mouth | smile '+str(side), [(0, -.852, 1.855), (side*.069, -.835, 1.822), (side*.133, -.805, 1.852)], .009, mouthmat, head)
    for index in range(3):
        line('Whisker '+str(side)+' / '+str(index), [(side*.27, -.736, 1.89-index*.055), (side*.68, -.76, 1.95-index*.075), (side*1.11, -.62, 2.01-index*.105)], .0037, whisker, head)

# Three soft crown locks retain the photograph's warm sandy forehead.
for index, x in enumerate([-.17, 0, .16]):
    lock = sphere('Crown | lock '+str(index), (x, -.01, 2.738), (.105, .21, .13), cream, head)
    lock.rotation_euler.y = -.35+index*.30

# Exposed hands and feet keep the character a hamster wearing equipment.
for side in [-1, 1]:
    arm = group(('Left' if side < 0 else 'Right')+'_Arm_PIVOT', (side*.61, -.20, 1.40))
    forearm = sphere('Arm | fur '+str(side), (side*.62, -.40, 1.19), (.24, .22, .38), cream, arm)
    forearm.rotation_euler.y = side*.27
    sphere('Paw | palm '+str(side), (side*.47, -.613, 1.07), (.16, .118, .14), pink, arm)
    for digit in range(3):
        sphere('Paw | finger '+str(side)+' / '+str(digit), (side*.47+(digit-1)*.063, -.697, 1.05), (.034, .079, .061), pink, arm)
    foot = group(('Left' if side < 0 else 'Right')+'_Foot_PIVOT', (side*.40, 0, .25))
    sphere('Leg | haunch '+str(side), (side*.48, .02, .41), (.32, .39, .37), cream, foot)
    sphere('Foot | pink sole '+str(side), (side*.39, -.28, .13), (.215, .33, .105), pink, foot)
    for digit in range(3):
        sphere('Foot | toe '+str(side)+' / '+str(digit), (side*.39+(digit-1)*.092, -.56, .125), (.048, .087, .051), pink, foot)
sphere('Tail | small nub', (0, .712, .40), (.13, .19, .13), pink, body)

# Harness follows the shoulders; equipment stays below the face.
for side in [-1, 1]:
    line('Harness | shoulder '+str(side), [(side*.45, .54, 1.42), (side*.54, .17, 1.67), (side*.48, -.40, 1.60), (side*.27, -.57, 1.34)], .068, navy, body)
    line('Harness | aqua piping '+str(side), [(side*.47, -.33, 1.61), (side*.39, -.50, 1.48), (side*.27, -.64, 1.34)], .015, cyan, body)
box('Chest | terminal housing', (0, -.658, 1.325), (.53, .15, .35), shell, .10, body)
box('Chest | dark glass', (0, -.746, 1.34), (.405, .055, .229), navy, .065, body)
line('Chest | prompt chevron', [(-.12, -.780, 1.405), (-.055, -.780, 1.345), (-.12, -.780, 1.285)], .015, cyan, body)
box('Chest | cursor', (.055, -.780, 1.29), (.082, .014, .024), cyan, .009, body)
sphere('Chest | amber LED', (.178, -.780, 1.395), (.017, .011, .017), amber, body)

pack = group('Backpack_PIVOT', (0, .65, 1.15), body)
box('Backpack | gasket', (0, .66, 1.20), (.76, .37, .87), navy, .16, pack)
box('Backpack | ceramic cover', (0, .874, 1.21), (.64, .18, .73), shell, .12, pack)
box('Backpack | energy window', (0, .976, 1.29), (.33, .029, .39), navy, .06, pack)
for z in [1.18, 1.29, 1.40]:
    box('Backpack | energy bar', (0, .997, z), (.21, .025, .034), cyan, .012, pack)
for side in [-1, 1]:
    cylinder('Backpack | battery '+str(side), (side*.45, .69, .91), (side*.45, .69, 1.43), .105, metal, pack)
    cylinder('Backpack | battery collar '+str(side), (side*.45, .69, 1.32), (side*.45, .69, 1.36), .111, cyan, pack)

# One communications pod rather than a helmet, so both real ears remain visible.
cylinder('Comms | cushion', (.85, .045, 2.19), (1.00, .045, 2.19), .225, navy, head)
cylinder('Comms | ceramic disc', (.98, .045, 2.19), (1.072, .045, 2.19), .195, shell, head)
cylinder('Comms | light ring', (1.073, .045, 2.19), (1.089, .045, 2.19), .137, cyan, head)
cylinder('Comms | center', (1.09, .045, 2.19), (1.11, .045, 2.19), .104, metal, head)
line('Comms | short antenna', [(1.02, .09, 2.32), (1.08, .11, 2.49), (1.04, .13, 2.60)], .020, metal, head)
sphere('Comms | amber tip', (1.04, .13, 2.60), (.046, .046, .046), amber, head)

root['design'] = 'H-02 / cream hamster with removable tech harness'
root['front_axis'] = '-Y'
root['reference_features'] = 'Cream fur, round ears, black eyes, pink nose, pale cheek pouches'
root['animation_status'] = 'Static model, separate rigid pivots; no rig or animation clips'

ground = box('Studio | floor', (0, 0, -.044), (200, 200, .08), floor, .005, None)
move(ground, studio)
world = bpy.data.worlds.new('Studio | ambient')
world.use_nodes = True
world.node_tree.nodes.get('Background').inputs[0].default_value = (.16, .22, .25, 1)
world.node_tree.nodes.get('Background').inputs[1].default_value = .35
scene.world = world


def area(name, position, power, color, size):
    bpy.ops.object.light_add(type='AREA', location=position)
    obj = move(bpy.context.object, studio)
    obj.name = name
    obj.data.energy = power
    obj.data.color = color
    obj.data.shape = 'DISK'
    obj.data.size = size
    obj.rotation_euler = (Vector((0, 0, 1.5))-obj.location).to_track_quat('-Z', 'Y').to_euler()


area('Key | warm softbox', (-3.5, -4.5, 6), 650, (1, .89, .75), 4.5)
area('Fill | neutral', (4, -4, 3.5), 380, (.80, .94, 1), 3.5)
area('Rim | cool teal', (2, 3, 5), 850, (.42, .89, 1), 3)
area('Top | cream', (-3, 1, 5), 450, (1, .86, .65), 3)
bpy.ops.object.camera_add(location=(4.3, -8, 3.5))
cam = move(bpy.context.object, studio)
cam.name = 'Camera | hero'
cam.data.type = 'ORTHO'
scene.camera = cam


def camera(position, scale):
    cam.location = position
    cam.rotation_euler = (Vector((0, 0, 1.52))-cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = scale


camera((4.3, -8, 3.5), 4.15)
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'AgX'
scene.render.resolution_x = scene.render.resolution_y = 1200
scene.render.filepath = str(OUT/'hero.png')

bpy.ops.object.select_all(action='DESELECT')
for obj in model.objects:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'forgebadger-h02.glb'), export_format='GLB', use_selection=True, export_animations=False, export_cameras=False, export_lights=False)
for screen in bpy.data.screens:
    for area_ui in screen.areas:
        if area_ui.type == 'VIEW_3D':
            area_ui.spaces.active.region_3d.view_perspective = 'CAMERA'
            area_ui.spaces.active.shading.type = 'MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'forgebadger-h02.blend'))
bpy.ops.render.render(write_still=True)

scene.render.resolution_x = 900
scene.render.resolution_y = 1000
for filename, position in [('front.png', (0, -9, 2.6)), ('rear.png', (4.5, 8, 3.5))]:
    camera(position, 3.85)
    scene.render.filepath = str(OUT/filename)
    bpy.ops.render.render(write_still=True)

camera((3.3, -8, 3.2), 3.8)
ground.hide_render = True
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = 640
scene.render.filepath = str(OUT/'pet-transparent.png')
bpy.ops.render.render(write_still=True)

meshes = [obj for obj in model.objects if obj.type == 'MESH']
triangles = 0
for obj in meshes:
    obj.data.calc_loop_triangles()
    triangles += len(obj.data.loop_triangles)
(OUT/'model-info.json').write_text(json.dumps({
    'blender': bpy.app.version_string, 'mesh_objects': len(meshes), 'triangles': triangles,
    'glb_bytes': (OUT/'forgebadger-h02.glb').stat().st_size,
    'animation_clips': 0, 'front_axis_blender': '-Y',
    'note': 'Procedural micro-fur bump is Blender-only; GLB contains base PBR materials.'
}, indent=2)+'\n')
print('H02_COMPLETE', triangles, flush=True)
