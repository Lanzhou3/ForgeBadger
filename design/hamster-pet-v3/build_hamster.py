"""Create the H-02 cream hamster in a separate Blender background process."""
import bpy
import json
import math
import random
import bisect
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
model = bpy.data.collections.new('H-03 | Buttercream plush hamster')
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


cream = material('Fur | warm oat cream', (.63, .47, .29), .76, fur=True)
light = material('Fur | vanilla cheeks and belly', (.84, .72, .52), .78, fur=True)
tuft = material('Fur | honey crown', (.49, .32, .16), .8, fur=True)
pink = material('Skin | rose petal', (.68, .30, .27), .53)
earpink = material('Ear | warm brown cup', (.22, .13, .075), .78, fur=True)
eye = material('Eyes | obsidian', (.006, .004, .003), .23)
nosemat = material('Nose | soft pink', (.37, .15, .11), .8)
mouthmat = material('Mouth | cocoa', (.16, .062, .031), .72)
whisker = material('Whiskers | cream', (.71, .60, .43), .65)
navy = material('Equipment | deep teal rubber', (.018, .075, .085), .42)
metal = material('Equipment | brushed titanium', (.16, .25, .27), .32, .7)
shell = material('Equipment | warm ceramic', (.70, .79, .72), .3, .18)
cyan = material('Signal | aqua', (.018, .65, .58), .25, .15, 2.1)
amber = material('Signal | amber', (.95, .30, .035), .3, .2, 1.2)
floor = material('Studio | midnight teal', (.33, .255, .22), .85)

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
    curve.use_fill_caps = True
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


# A squat bean-shaped plush silhouette: no long torso or distinct neck.
parts = []
def volume(name, pos, scale):
    obj = sphere(name, pos, scale, cream)
    parts.append(obj)
    return obj

volume('Body | round weighted bean', (0, .04, .88), (.87, .68, .84))
volume('Head | tucked into body', (0, -.08, 1.47), (.79, .62, .64))
for side in [-1, 1]:
    volume('Cheek | softly full', (side*.33, -.40, 1.24), (.37, .29, .28))
volume('Muzzle | soft shallow bridge', (0, -.55, 1.34), (.27, .18, .20))
bpy.ops.object.select_all(action='DESELECT')
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
skin = bpy.context.object
skin.name = 'Plush | continuous bean body'
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
remesh = skin.modifiers.new('Soft stuffed volume', 'REMESH')
remesh.mode = 'VOXEL'
remesh.voxel_size = .018
bpy.ops.object.modifier_apply(modifier=remesh.name)
smooth = skin.modifiers.new('Blend cheeks into face', 'SMOOTH')
smooth.factor = 1.25
smooth.iterations = 11
bpy.ops.object.modifier_apply(modifier=smooth.name)
sub = skin.modifiers.new('Silky base', 'SUBSURF')
sub.levels = 1
bpy.ops.object.modifier_apply(modifier=sub.name)
for poly in skin.data.polygons:
    poly.use_smooth = True

# Small partially buried brown ears, round bead eyes, simplified fabric paws.
ear_objects = []
arm_objects = []
for side in [-1, 1]:
    ear = sphere('Ear | small cocoa plush '+str(side), (side*.535, -.015, 2.024), (.169, .095, .184), earpink)
    ear.rotation_euler.y = side*.30
    ear_objects.append(ear)
    sphere('Eye | black bead '+str(side), (side*.321, -.633, 1.57), (.062, .044, .071), eye)
    arm = sphere('Arm | tucked plush '+str(side), (side*.255, -.575, .985), (.175, .156, .197), cream)
    arm.rotation_euler.y = -side*.66
    arm_objects.append(arm)
    paw = sphere('Paw | folded mitten '+str(side), (side*.102, -.715, .971), (.082, .046, .092), pink)
    paw.rotation_euler.y = -side*.25
    # Subtle thread grooves instead of sculpted fingers and claws.
    for dx in [-.022, .015]:
        x = side*.102+dx
        line('Paw | stitched crease', [(x, -.758, .985), (x+.005, -.760, .949)], .0018, nosemat)
    foot = sphere('Foot | tiny fabric bean '+str(side), (side*.35, -.27, .15), (.125, .20, .09), pink)
    foot.rotation_euler.z = -side*.16

nose = sphere('Nose | embroidered triangle', (0, -.742, 1.389), (.054, .017, .038), nosemat)
for vert in nose.data.vertices:
    vert.co.x *= .25+.75*(vert.co.z+1)/2
line('Mouth | short stitch', [(0, -.750, 1.354), (0, -.752, 1.315)], .004, mouthmat)
for side in [-1, 1]:
    line('Mouth | little w', [(0, -.752, 1.315), (side*.033, -.750, 1.298), (side*.060, -.742, 1.317)], .004, mouthmat)

# One small removable tech badge. No earphones, backpack, harness or whiskers.
badge = group('Badge | removable', (.445, -.548, .66))
box('Badge | ceramic rim', (.445, -.548, .66), (.245, .074, .178), shell, .045, badge)
box('Badge | inset glass', (.445, -.592, .665), (.180, .018, .111), navy, .025, badge)
line('Badge | prompt', [(.391, -.605, .69), (.420, -.605, .665), (.391, -.605, .641)], .0065, cyan, badge)
box('Badge | cursor', (.477, -.605, .642), (.040, .009, .011), cyan, .004, badge)

# Dense short, curled pile. Most fibers are under 1.5% of total toy height.
fur_collection = bpy.data.collections.new('PILE | short dense plush')
scene.collection.children.link(fur_collection)
palette = [(.62,.46,.28), (.70,.54,.35), (.78,.63,.43), (.83,.70,.50),
           (.88,.77,.59), (.22,.13,.075), (.29,.18,.11)]
hair_materials = [material('Pile | tone '+str(i), color, .88) for i, color in enumerate(palette)]
for mat in hair_materials:
    mat.node_tree.nodes.get('Principled BSDF').inputs['Sheen Weight'].default_value = .5

hair_count = 0
def groom(obj, count, kind='body'):
    global hair_count
    rng = random.Random(1700+count)
    bpy.context.view_layer.update()
    obj.data.calc_loop_triangles()
    vertices = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
    normals = [(normal_matrix @ vertex.normal).normalized() for vertex in obj.data.vertices]
    triangles = list(obj.data.loop_triangles)
    areas, total = [], 0
    for triangle in triangles:
        a,b,c = [vertices[index] for index in triangle.vertices]
        total += (b-a).cross(c-a).length/2
        areas.append(total)
    curves = []
    for index, mat in enumerate(hair_materials):
        curve = bpy.data.curves.new('Short pile '+str(index), 'CURVE')
        curve.dimensions = '3D'
        curve.bevel_depth = .00085
        curve.bevel_resolution = 0
        curve.resolution_u = 1
        curve.materials.append(mat)
        obj_fur = bpy.data.objects.new(obj.name+' | pile '+str(index), curve)
        fur_collection.objects.link(obj_fur)
        curves.append(curve)
    for i in range(count):
        triangle = triangles[bisect.bisect_left(areas, rng.random()*total)]
        a,b,c = triangle.vertices
        u,v = rng.random(),rng.random()
        if u+v>1:
            u,v = 1-u,1-v
        p = vertices[a]*(1-u-v)+vertices[b]*u+vertices[c]*v
        normal = (normals[a]*(1-u-v)+normals[b]*u+normals[c]*v).normalized()
        if kind=='body':
            if p.y<-.48 and any(((p.x-side*.321)/.078)**2+((p.z-1.57)/.090)**2<1 for side in [-1,1]):
                continue
            if p.y<-.66 and abs(p.x)<.078 and 1.28<p.z<1.435:
                continue
            if p.y<-.51 and .30<p.x<.59 and .55<p.z<.77:
                continue
        length = rng.uniform(.012,.025)
        if rng.random()<.12:
            length *= 1.45
        if kind=='ear':
            length *= .60
        flow = Vector((p.x*.30,.06,-.16))
        if p.z>1.2:
            flow = Vector((p.x*.45,0,(p.z-1.37)*.25))
        tangent = flow-normal*normal.dot(flow)
        if tangent.length<.001:
            tangent = normal.cross(Vector((1,0,0)))
        tangent.normalize()
        across = normal.cross(tangent).normalized()
        angle = rng.uniform(0,math.tau)
        curl = tangent*math.cos(angle)+across*math.sin(angle)
        direction = (normal*.80+tangent*.28+curl*.25).normalized()
        # Natural cream face and a very subtle lighter tummy, without sewn-on discs.
        tone = rng.choices([0,1,2,3],[1,4,6,3])[0]
        if p.y<-.40 and abs(p.x)<.45 and p.z<1.34:
            tone = rng.choice([2,3,4])
        if kind=='ear':
            tone = rng.choice([5,5,6])
        spline = curves[tone].splines.new('POLY')
        spline.points.add(3)
        for j,point in enumerate(spline.points):
            t=j/3
            co=p-normal*.002+direction*length*t+curl*length*.28*math.sin(t*math.pi*.85)
            point.co=(*co,1)
            point.radius=[1,.90,.61,.08][j]
        hair_count += 1
    print('PLUSH_GROOMED',obj.name,hair_count,flush=True)

groom(skin,150000)
for ear in ear_objects:
    groom(ear,3500,'ear')
for arm in arm_objects:
    groom(arm,6500,'arm')
root['design']='H-03 | buttercream plush, bean body, small brown ears, folded paws'
root['front_axis']='-Y'
root['animation_status']='Static sculpture, pile not rigged'



ground = box('Studio | floor', (0, 0, -.044), (200, 200, .08), floor, .005, None)
move(ground, studio)
world = bpy.data.worlds.new('Studio | ambient')
world.use_nodes = True
world.node_tree.nodes.get('Background').inputs[0].default_value = (.32, .28, .24, 1)
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
    obj.rotation_euler = (Vector((0, 0, 1.1))-obj.location).to_track_quat('-Z', 'Y').to_euler()


area('Key | warm softbox', (-3.5, -4.5, 6), 480, (1, .94, .85), 4.5)
area('Fill | neutral', (4, -4, 3.5), 220, (.92, .96, 1), 3.5)
area('Rim | cool teal', (2, 3, 5), 400, (1, .87, .73), 3)
area('Top | cream', (-3, 1, 5), 250, (1, .96, .90), 3)
bpy.ops.object.camera_add(location=(4.3, -8, 3.5))
cam = move(bpy.context.object, studio)
cam.name = 'Camera | hero'
cam.data.type = 'ORTHO'
scene.camera = cam


def camera(position, scale):
    cam.location = position
    cam.rotation_euler = (Vector((0, 0, 1.10))-cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = scale


camera((2.7, -9, 3.05), 3.12)
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'AgX'
scene.render.resolution_x = scene.render.resolution_y = 1200
scene.render.filepath = str(OUT/'hero.png')

for screen in bpy.data.screens:
    for area_ui in screen.areas:
        if area_ui.type == 'VIEW_3D':
            area_ui.spaces.active.region_3d.view_perspective = 'CAMERA'
            area_ui.spaces.active.shading.type = 'MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'forgebadger-h03-plush.blend'))
bpy.ops.render.render(write_still=True)

scene.render.resolution_x = 900
scene.render.resolution_y = 1000
for filename, position in [('front.png', (0, -9, 2.8)), ('rear.png', (4.5, 8, 3.2))]:
    camera(position, 3.0)
    scene.render.filepath = str(OUT/filename)
    bpy.ops.render.render(write_still=True)

camera((2.7, -9, 3.05), 2.8)
ground.hide_render = True
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = 640
scene.render.filepath = str(OUT/'pet-transparent.png')
bpy.ops.render.render(write_still=True)


(OUT/'model-info.json').write_text(json.dumps({'blender':bpy.app.version_string,'fur_strands':hair_count,'fur_geometry':'short curled plush pile','animation_clips':0,'glb_export':False},indent=2)+'\n')
print('H03_PLUSH_COMPLETE', hair_count, flush=True)
