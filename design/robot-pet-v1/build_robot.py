"""Rebuild with Blender --background --python build_robot.py. No external assets."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for coll in list(bpy.data.collections):
    if coll.name != 'Collection': bpy.data.collections.remove(coll)
scene = bpy.context.scene
model = bpy.data.collections.new('ROBOT • ForgeBadger / FB-01')
scene.collection.children.link(model)
studio = bpy.data.collections.new('STUDIO • not exported')
scene.collection.children.link(studio)

def move(obj, coll=model):
    for c in list(obj.users_collection): c.objects.unlink(obj)
    coll.objects.link(obj)
    return obj

def mat(name, color, metal=0, rough=.35, emission=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    if emission:
        bs.inputs['Emission Color'].default_value=(*color,1)
        bs.inputs['Emission Strength'].default_value=emission
    return m
ivory=mat('Shell | warm ceramic',(.72,.77,.76),.18,.28)
white=mat('Trim | porcelain',(.9,.93,.88),.12,.24)
dark=mat('Joint | graphite elastomer',(.025,.04,.048),.2,.38)
metal=mat('Hardware | brushed titanium',(.19,.26,.29),.75,.3)
visor=mat('Face | midnight glass',(.008,.022,.032),.32,.19)
cyan=mat('Signal | ForgeBadger cyan',(.025,.78,.91),.25,.24,2.7)
orange=mat('Accent | forge orange',(.98,.23,.038),.1,.3)
amber=mat('Signal | warm amber', (1,.28,.045),.2,.2,2)
floor=mat('Studio | deep blue',(.017,.028,.043),.1,.55)

root=bpy.data.objects.new('FB-01_ROOT',None)
model.objects.link(root)

def group(name,loc,parent=root):
    o=bpy.data.objects.new(name,None); model.objects.link(o); o.location=loc
    o.parent=parent; return o

def finish(o,name,m,parent):
    o.name=name; move(o); o.data.materials.append(m)
    if parent:
        bpy.context.view_layer.update()
        world=o.matrix_world.copy(); o.parent=parent; o.matrix_world=world
    return o

def box(name,loc,dim,m,r=.1,parent=root):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object
    o.dimensions=dim; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if r:
        b=o.modifiers.new('Manufactured edge radii','BEVEL'); b.width=r; b.segments=5
        bpy.ops.object.modifier_apply(modifier=b.name)
    for p in o.data.polygons: p.use_smooth=True
    n=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL'); n.keep_sharp=True; n.weight=50
    bpy.ops.object.modifier_apply(modifier=n.name)
    return finish(o,name,m,parent)

def sphere(name,loc,scale,m,parent=root):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=loc)
    o=bpy.context.object; o.scale=scale
    for p in o.data.polygons:p.use_smooth=True
    return finish(o,name,m,parent)

def cyl(name,a,b,r,m,parent=root,vertices=32):
    a,b=Vector(a),Vector(b); d=b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=d.length,location=(a+b)/2)
    o=bpy.context.object; o.rotation_euler=d.to_track_quat('Z','Y').to_euler()
    be=o.modifiers.new('Soft machined edge','BEVEL'); be.width=.025;be.segments=3
    bpy.ops.object.modifier_apply(modifier=be.name)
    for p in o.data.polygons:p.use_smooth=True
    return finish(o,name,m,parent)

def line(name,points,r,m,parent=root):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.resolution_u=12
    curve.bevel_depth=r;curve.bevel_resolution=3
    sp=curve.splines.new('BEZIER');sp.bezier_points.add(len(points)-1)
    for p,co in zip(sp.bezier_points,points):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,curve);model.objects.link(o);curve.materials.append(m)
    bpy.context.view_layer.objects.active=o;o.select_set(True)
    bpy.ops.object.convert(target='MESH');o=bpy.context.object;o.select_set(False)
    if parent:o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted()
    return o

def label(name,txt,loc,size,m,parent=root):
    bpy.ops.object.text_add(location=loc,rotation=(math.pi/2,0,0));o=bpy.context.object
    o.data.body=txt;o.data.align_x='CENTER';o.data.size=size;o.data.extrude=.0006
    bpy.ops.object.convert(target='MESH'); return finish(o,name,m,parent)

# Front faces negative Y; ground is Z=0. Rigid parts stay individually editable.
body=group('Body_PIVOT',(0,0,1.45))
box('Torso / ceramic monocoque',(0,0,1.45),(1.28,.84,1.04),ivory,.24,body)
box('Waist seal',(0,0,.96),(.91,.66,.17),dark,.08,body)
box('Chest / inset panel',(0,-.428,1.48),(.81,.08,.49),dark,.095,body)
box('Chest / inset glass',(0,-.478,1.49),(.69,.035,.36),visor,.06,body)
# Compact terminal cursor, readable at pet size.
line('Chest / prompt', [(-.22,-.502,1.58),(-.12,-.502,1.50),(-.22,-.502,1.42)],.026,cyan,body)
box('Chest / cursor',(.08,-.502,1.42),(.17,.024,.035),cyan,.012,body)
label('Chest / serial','FB-01',(0,-.416,1.115),.091,metal,body)
for i,m in enumerate([cyan,amber,metal]):
    sphere('Chest / status '+str(i),(.28+i*.085,-.406,1.83),(.026,.018,.026),m,body)
box('Backpack',(0,.48,1.44),(.83,.29,.65),dark,.12,body)
box('Backpack / lid',(0,.64,1.46),(.69,.06,.51),ivory,.09,body)
for z in [1.33,1.43,1.53]:box('Backpack / vent',(0,.677,z),(.4,.025,.035),metal,.015,body)

cyl('Neck actuator',(0,0,1.87),(0,0,2.13),.24,metal)
head=group('Head_PIVOT',(0,0,2.40))
box('Head / shell',(0,0,2.53),(1.97,1.16,1.40),ivory,.34,head)
box('Head / visor gasket',(0,-.558,2.54),(1.78,.15,1.07),dark,.28,head)
box('Head / glass display',(0,-.649,2.54),(1.64,.105,.92),visor,.255,head)
# Two wide luminous capsule eyes and an understated friendly mouth.
for x in [-.385,.385]:
    box('Eye / '+str(x),(x,-.711,2.63),(.24,.044,.34),cyan,.105,head)
line('Face / smile',[(-.13,-.713,2.34),(0,-.719,2.30),(.13,-.713,2.34)],.023,cyan,head)
for x in [-.65,.65]:
    for dx in [-.04,.04]:box('Face / cheek',(x+dx,-.692,2.36),(.021,.024,.072),metal,.01,head)
# Small eyebrow-like engraved marks in the crown, not another display.
for x in [-.47,.47]:
    s=box('Crown / inset stripe',(x,-.19,3.212),(.12,.49,.016),metal,.007,head)
    s.rotation_euler.z=(-.22 if x<0 else .22)
for s in [-1,1]:
    cyl('Ear / gasket', (s*.94,0,2.54),(s*1.07,0,2.54),.32,dark,head)
    cyl('Ear / ceramic pod',(s*1.05,0,2.54),(s*1.20,0,2.54),.275,white,head)
    cyl('Ear / orange ring',(s*1.195,0,2.54),(s*1.217,0,2.54),.188,orange,head)
    cyl('Ear / inset center',(s*1.216,0,2.54),(s*1.23,0,2.54),.115,metal,head)
# Offset antenna adds an immediately recognizable silhouette.
cyl('Antenna / socket',(.55,.09,3.10),(.55,.09,3.27),.125,dark,head)
cyl('Antenna / mast',(.55,.09,3.22),(.67,.09,3.60),.041,metal,head)
sphere('Antenna / amber beacon',(.68,.09,3.63),(.12,.12,.12),amber,head)

for s in [-1,1]:
    leg=group(('Left' if s<0 else 'Right')+'_Leg_PIVOT',(s*.36,0,.98))
    cyl('Hip / joint',(s*.36,0,.70),(s*.36,0,1.0),.16,dark,leg)
    box('Leg / shin',(s*.36,0,.59),(.37,.41,.48),white,.12,leg)
    box('Boot / sole',(s*.40,-.12,.115),(.59,.79,.17),dark,.075,leg)
    box('Boot / shell',(s*.40,-.16,.30),(.60,.77,.33),ivory,.125,leg)
    box('Boot / orange toe',(s*.40,-.551,.28),(.26,.027,.055),orange,.02,leg)

# One arm rests, one lifts slightly in a welcoming gesture.
for s in [-1,1]:
    arm=group(('Left' if s<0 else 'Right')+'_Arm_PIVOT',(s*.68,0,1.75))
    shoulder=(s*.70,0,1.72)
    elbow=(s*.99,-.025,1.33 if s<0 else 1.58)
    wrist=(s*1.06,-.09,1.07) if s<0 else (1.28,-.12,1.90)
    sphere('Shoulder / joint',shoulder,(.20,.20,.20),dark,arm)
    cyl('Arm / upper',shoulder,elbow,.17,ivory,arm)
    sphere('Elbow / joint',elbow,(.145,.145,.145),metal,arm)
    cyl('Arm / forearm',elbow,wrist,.18,white,arm)
    sphere('Wrist / joint',wrist,(.13,.13,.13),dark,arm)
    palm=Vector(wrist)+Vector((s*.025,0,-.16 if s<0 else .16))
    box('Hand / palm',palm,(.30,.28,.24),ivory,.09,arm)
    direction=-1 if s<0 else 1
    for dx in [-.105,.105]:
        p=palm+Vector((dx,0,direction*.16))
        box('Hand / rounded gripper',p,(.09,.23,.20),dark,.04,arm)
        box('Hand / tip',p+Vector((0,-.015,direction*.065)),(.09,.22,.08),ivory,.035,arm)

bpy.context.view_layer.update()
# Save a clean rigid hierarchy; real animation is a later integration step.
root['design']='ForgeBadger FB-01 / ceramic companion'
root['front_axis']='-Y';root['notes']='Separated head, arms and legs; no rig or animation clips yet.'

# Studio.
box('Stage / ground',(0,0,-.075),(200,200,.1),floor,.0,parent=None)
move(bpy.context.object,studio)
world=bpy.data.worlds.new('Studio ambient');world.use_nodes=True
next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND').inputs[0].default_value=(.14,.20,.29,1)
next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND').inputs[1].default_value=.32;scene.world=world

def area(name,loc,power,color,size,target=(0,0,1.7)):
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;move(o,studio)
    o.data.energy=power;o.data.color=color;o.data.shape='DISK';o.data.size=size
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
area('Key / softbox',(-4,-5,7),700,(.82,.93,1),5)
area('Fill / warm',(4,-2,4),420,(1,.80,.64),4)
area('Rim / cyan',(2,4,5),950,(.34,.77,1),3)
area('Top / strip',(-3,2,6),550,(1,1,1),3)
bpy.ops.object.camera_add(location=(5,-8,4.3));cam=bpy.context.object;move(cam,studio)
cam.name='Camera / hero';cam.rotation_euler=(Vector((0,0,1.86))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO';cam.data.ortho_scale=5.15;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True
scene.render.resolution_x=1200;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
scene.render.film_transparent=False

# Export only the character, including rigid pivots, PBR materials, and mesh text.
bpy.ops.object.select_all(action='DESELECT')
for obj in model.objects:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'forgebadger-fb01.glb'),export_format='GLB',use_selection=True,export_animations=False,export_cameras=False,export_lights=False)
# Set the authoring viewport to a useful material-preview framing.
for screen in bpy.data.screens:
    for a in screen.areas:
        if a.type=='VIEW_3D':
            a.spaces.active.region_3d.view_perspective='CAMERA'
            a.spaces.active.shading.type='MATERIAL'
scene.render.filepath=str(OUT/'hero.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'forgebadger-fb01.blend'))
bpy.ops.render.render(write_still=True)
cam.location=(0,-9,3.15);cam.rotation_euler=(Vector((0,0,1.85))-cam.location).to_track_quat('-Z','Y').to_euler()
scene.render.resolution_x=900;scene.render.resolution_y=1100;cam.data.ortho_scale=4.8
scene.render.filepath=str(OUT/'front.png');bpy.ops.render.render(write_still=True)
cam.location=(-5,8,4.0);cam.rotation_euler=(Vector((0,0,1.85))-cam.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(OUT/'rear.png');bpy.ops.render.render(write_still=True)
# Transparent front image can be used for an inexpensive sprite-based Web pet.
cam.location=(4,-8,3.8);cam.rotation_euler=(Vector((0,0,1.85))-cam.location).to_track_quat('-Z','Y').to_euler()
for o in studio.objects:
    if o.type=='MESH':o.hide_render=True
scene.render.film_transparent=True;scene.render.image_settings.color_mode='RGBA'
scene.render.resolution_x=640;scene.render.resolution_y=640;cam.data.ortho_scale=4.6
scene.render.filepath=str(OUT/'pet-transparent.png');bpy.ops.render.render(write_still=True)
meshes=[o for o in model.objects if o.type=='MESH']
triangles=0
for o in meshes:o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles)
(OUT/'model-info.json').write_text(json.dumps({'blender':bpy.app.version_string,'mesh_objects':len(meshes),'triangles':triangles,'glb_bytes':(OUT/'forgebadger-fb01.glb').stat().st_size,'animation_clips':0},indent=2)+'\n')
print('FB01_COMPLETE',triangles)
