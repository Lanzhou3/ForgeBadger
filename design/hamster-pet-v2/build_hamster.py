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
model = bpy.data.collections.new('H-02 v2 | Reference fur study')
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


cream = material('Fur | warm oat cream', (.48, .37, .24), .76, fur=True)
light = material('Fur | vanilla cheeks and belly', (.74, .63, .46), .78, fur=True)
tuft = material('Fur | honey crown', (.49, .32, .16), .8, fur=True)
pink = material('Skin | rose petal', (.68, .30, .27), .53)
earpink = material('Ear | warm brown cup', (.105, .048, .024), .78, fur=True)
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


# Merge intersecting volumes into one organic surface, avoiding toy-like seams.
organic = []
def volume(name, pos, scale):
    obj = sphere(name, pos, scale, cream)
    organic.append(obj)
    return obj

volume('Torso', (0, .12, .97), (.65, .53, .95))
volume('Shoulders', (0, .05, 1.60), (.57, .49, .56))
volume('Skull', (0, -.04, 2.12), (.63, .51, .59))
volume('Tapered muzzle bridge', (0, -.46, 2.04), (.30, .36, .31))
volume('Muzzle tip', (0, -.70, 1.94), (.20, .19, .14))
for side in [-1, 1]:
    volume('Natural cheek', (side*.31, -.23, 1.92), (.34, .40, .36))
    volume('Haunch', (side*.41, .10, .44), (.28, .37, .36))
    arm = volume('Foreleg', (side*.46, -.29, 1.16), (.17, .20, .39))
    arm.rotation_euler.y = side*.22
bpy.ops.object.select_all(action='DESELECT')
for obj in organic:
    obj.select_set(True)
bpy.context.view_layer.objects.active = organic[0]
bpy.ops.object.join()
skin = bpy.context.object
skin.name = 'Hamster | continuous sculpted skin'
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
remesh = skin.modifiers.new('Fused anatomy', 'REMESH')
remesh.mode = 'VOXEL'
remesh.voxel_size = .022
bpy.ops.object.modifier_apply(modifier=remesh.name)
smooth = skin.modifiers.new('Organic transitions', 'SMOOTH')
smooth.factor = 1.4
smooth.iterations = 9
bpy.ops.object.modifier_apply(modifier=smooth.name)
sub = skin.modifiers.new('Smooth skin', 'SUBSURF')
sub.levels = 1
bpy.ops.object.modifier_apply(modifier=sub.name)
for poly in skin.data.polygons:
    poly.use_smooth = True

ear_objects = []
for side in [-1, 1]:
    ear = sphere('Ear | thin warm rim '+str(side), (side*.46, .025, 2.67), (.202, .080, .25), cream)
    ear.rotation_euler.y = side*.30
    ear_objects.append(ear)
    inner = sphere('Ear | dark translucent cup '+str(side), (side*.465, -.050, 2.69), (.146, .027, .186), earpink)
    inner.rotation_euler.y = side*.30
    orb = sphere('Eye | small black '+str(side), (side*.325, -.516, 2.23), (.069, .060, .097), eye)
    orb.rotation_euler.z = side*.25
    sphere('Paw | fine palm '+str(side), (side*.39, -.470, .92), (.091, .064, .12), pink)
    for digit in range(4):
        x = side*.39 + (digit-1.5)*.038
        line('Paw | long digit', [(x, -.51, .91), (x+side*.006, -.54, .855), (x+side*.017, -.55, .84)], .015, pink)
    sphere('Foot | small heel '+str(side), (side*.34, -.23, .105), (.14, .235, .073), pink)
    for digit in range(4):
        x = side*.34+(digit-1.5)*.053
        line('Foot | fine digit', [(x, -.37, .115), (x, -.45, .092), (x+.01, -.49, .087)], .019, pink)
sphere('Tail | tiny', (0, .616, .30), (.075, .12, .083), pink)

# Small triangular nose with a narrower lower tip, rather than a round toy button.
nose = sphere('Nose | tapered pink', (0, -.896, 1.966), (.090, .048, .065), nosemat)
for v in nose.data.vertices:
    v.co.x *= .40+.60*(v.co.z+1)/2
line('Mouth | center', [(0, -.887, 1.918), (0, -.864, 1.882)], .0055, mouthmat)
for side in [-1, 1]:
    line('Mouth | tiny lip', [(0, -.864, 1.882), (side*.045, -.849, 1.875)], .005, mouthmat)
    for i in range(7):
        rng = random.Random(i+int(side)*30)
        line('Whisker | fine curved', [(side*.16, -.773, 1.95-i*.023), (side*(.35+rng.random()*.17), -.83-rng.random()*.08, 2.00-i*.029+rng.uniform(-.05,.05)), (side*(.69+rng.random()*.30), -.68+rng.random()*.16, 2.14-i*.068+rng.uniform(-.055,.055))], .0011, whisker)

# A tiny lightweight communicator and lower chest clip keep the reference face visible.
for side in [-1, 1]:
    line('Harness | thin strap', [(side*.27, .48, 1.29), (side*.43, .08, 1.59), (side*.36, -.42, 1.49), (side*.15, -.525, 1.26)], .031, navy)
box('Chest | ceramic micro terminal', (0, -.532, 1.24), (.30, .12, .21), shell, .05)
box('Chest | glass', (0, -.602, 1.25), (.23, .025, .137), navy, .025)
line('Chest | prompt', [(-.065, -.619, 1.28), (-.03, -.619, 1.25), (-.065, -.619, 1.22)], .008, cyan)
box('Chest | cursor', (.042, -.619, 1.22), (.045, .01, .014), cyan, .004)
box('Pack | compact shell', (0, .653, 1.23), (.43, .23, .59), shell, .10)
for z in [1.10, 1.22, 1.34]:
    box('Pack | energy status', (0, .779, z), (.18, .018, .022), cyan, .008)
cylinder('Comms | small cushion', (.56, .12, 2.24), (.68, .12, 2.24), .121, navy)
cylinder('Comms | titanium rim', (.679, .12, 2.24), (.706, .12, 2.24), .102, metal)
cylinder('Comms | aqua ring', (.707, .12, 2.24), (.719, .12, 2.24), .074, cyan)
cylinder('Comms | ceramic center', (.72, .12, 2.24), (.731, .12, 2.24), .058, shell)

# Actual tapered curved strands, groomed from the face outward and down the torso.
# Geometry lives in the .blend, so the silhouette and light scattering are real.
fur_collection = bpy.data.collections.new('FUR | groomed tapered strands')
scene.collection.children.link(fur_collection)
fur_palette = [
    (.40, .305, .205), (.51, .403, .275), (.60, .49, .35),
    (.72, .61, .445), (.81, .72, .55), (.88, .80, .64),
    (.27, .212, .145), (.36, .285, .19),
]
hair_materials = [material('Hair | tone '+str(i), col, .67) for i, col in enumerate(fur_palette)]
for mat in hair_materials:
    bs = mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Sheen Weight'].default_value = .55

hair_count = 0
def groom(obj, count, ears=False):
    global hair_count
    rng = random.Random(321+count)
    bpy.context.view_layer.update()
    obj.data.calc_loop_triangles()
    verts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
    normals = [(normal_matrix @ v.normal).normalized() for v in obj.data.vertices]
    tris = list(obj.data.loop_triangles)
    areas = []
    total = 0
    for tri in tris:
        a, b, c = [verts[k] for k in tri.vertices]
        total += (b-a).cross(c-a).length/2
        areas.append(total)
    curves = []
    for index, mat in enumerate(hair_materials):
        curve = bpy.data.curves.new('Fur strands '+str(index), 'CURVE')
        curve.dimensions = '3D'
        curve.resolution_u = 1
        curve.bevel_depth = .0010 if not ears else .00075
        curve.bevel_resolution = 0
        curve.resolution_u = 1
        curve.materials.append(mat)
        fur = bpy.data.objects.new(obj.name+' / fur '+str(index), curve)
        fur_collection.objects.link(fur)
        curves.append(curve)
    for i in range(count):
        tri = tris[bisect.bisect_left(areas, rng.random()*total)]
        a, b, c = tri.vertices
        u, v = rng.random(), rng.random()
        if u+v>1:
            u, v = 1-u, 1-v
        p = verts[a]*(1-u-v)+verts[b]*u+verts[c]*v
        n = (normals[a]*(1-u-v)+normals[b]*u+normals[c]*v).normalized()
        if not ears:
            if p.y < -.40 and any(((p.x-s*.325)/.095)**2+((p.z-2.23)/.122)**2<1 for s in [-1, 1]):
                continue
            if p.y < -.80 and (p.x/.108)**2+((p.z-1.963)/.083)**2 < 1:
                continue
            if p.y < -.47 and abs(p.x)<.18 and 1.115<p.z<1.375:
                continue
            if p.x>.55 and abs(p.y-.12)<.13 and abs(p.z-2.24)<.14:
                continue
        length = rng.uniform(.042, .079) if rng.random()<.72 else rng.uniform(.08, .13)
        flow = Vector((p.x*.18, .06, -.75))
        if p.z>1.7:
            length = rng.uniform(.033, .065)
            flow = Vector((p.x*.95, .15, (p.z-2.03)*1.25))
            if p.y<-.60:
                length *= .55
            if p.z>2.54:
                length *= 1.3
        if ears:
            length = rng.uniform(.016, .04)
            flow = Vector((p.x*.4, .1, .5))
        tangent = flow-n*flow.dot(n)
        if tangent.length>.001:
            tangent.normalize()
        spread = Vector((rng.gauss(0,.22), rng.gauss(0,.22), rng.gauss(0,.22)))
        direction = (n*.66+tangent*.56+spread*.17).normalized()
        # Warm cream, with a soft darker crown like the reference photograph.
        tone = rng.choices([1,2,3,4,5], [1,2,4,4,2])[0]
        crown = p.z>2.43 and abs(p.x)<.20 and p.y<.28
        if crown and rng.random()<.64:
            tone = rng.choice([0,1,2,6,7])
        elif p.y>0.10 and rng.random()<.40:
            tone = rng.choice([0,1,2,3])
        elif p.y<-.37 and p.z<1.72:
            tone = rng.choice([3,4,5])
        if ears:
            tone = rng.choice([0,1,2,3,4])
        spline = curves[tone].splines.new('POLY')
        spline.points.add(3)
        wave = n.cross(tangent)
        flutter = rng.uniform(-.16, .16)
        for j, point in enumerate(spline.points):
            t = j/3
            co = p-n*.003 + direction*length*t + tangent*length*.28*t*t + wave*math.sin(t*math.pi)*length*flutter
            point.co = (*co, 1)
            point.radius = [1, .83, .43, .045][j]
        hair_count += 1
    print('GROOMED', obj.name, hair_count, flush=True)

groom(skin, 105000)
for ear in ear_objects:
    groom(ear, 3500, ears=True)

root['design'] = 'H-02 v2 / cream Syrian hamster reference study with physical fur'
root['front_axis'] = '-Y'
root['animation_status'] = 'Static sculpt; grooming is not rigged'


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


camera((2.3, -8, 3.1), 3.85)
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
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'forgebadger-h02-fur.blend'))
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


(OUT/'model-info.json').write_text(json.dumps({'blender':bpy.app.version_string,'fur_strands':hair_count,'fur_geometry':'tapered curved strands','animation_clips':0,'glb_export':False},indent=2)+'\n')
print('H02_V2_COMPLETE', hair_count, flush=True)
