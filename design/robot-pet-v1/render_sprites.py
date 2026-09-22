"""Run inside Blender's Python console. Append the model into a separate scene."""
import bpy, math, json, shutil, tempfile
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parent/'frames'
OUT.mkdir(exist_ok=True)
source_copy=Path(tempfile.gettempdir())/'fb01-sprite-source.blend'
shutil.copyfile(OUT.parent/'forgebadger-fb01.blend',source_copy)
with bpy.data.libraries.load(str(source_copy),link=False) as (src,dst):
    dst.scenes=[src.scenes[0]]
scene=dst.scenes[0]
scene.name='FB01 • Web sprites'
bpy.context.window.scene=scene
objects=list(scene.objects)
def obj(prefix):return next(o for o in objects if o.name.startswith(prefix))
root=obj('FB-01_ROOT')
base={o:o.matrix_basis.copy() for o in objects if o.type not in ['CAMERA','LIGHT']}
head=obj('Head_PIVOT');body=obj('Body_PIVOT')
leftarm=obj('Left_Arm_PIVOT');rightarm=obj('Right_Arm_PIVOT')
leftleg=obj('Left_Leg_PIVOT');rightleg=obj('Right_Leg_PIVOT')
eyes=[o for o in objects if o.name.startswith('Eye /')]
scene.camera.location=(3.4,-8,3.3)
scene.camera.rotation_euler=(Vector((0,-.06,1.85))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.ortho_scale=4.05
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=192;scene.render.resolution_y=192;scene.render.resolution_percentage=100
scene.render.film_transparent=True
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
for o in objects:
    if o.name.startswith('Stage /'):o.hide_render=True
# A small clamshell laptop belongs only to the sitting poses.
collection=root.users_collection[0]
def box(name,loc,dim,material,r=.04):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name
    o.dimensions=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    b=o.modifiers.new('Soft edges','BEVEL');b.width=r;b.segments=3
    bpy.ops.object.modifier_apply(modifier=b.name)
    for p in o.data.polygons:p.use_smooth=True
    o.data.materials.append(material)
    for c in list(o.users_collection):c.objects.unlink(o)
    collection.objects.link(o)
    return o
mats={m.name.split('.')[0]:m for m in bpy.data.materials}
def material(prefix):return next(m for m in bpy.data.materials if m.name.startswith(prefix))
laptop=[]
laptop.append(box('Laptop / base',(0,-.93,.49),(1.28,.68,.075),material('Joint |')))
laptop.append(box('Laptop / keyboard',(0,-.91,.536),(1.05,.46,.019),material('Hardware |'),.02))
# Display back faces the viewer; cyan badge makes it readable at 88 px.
laptop.append(box('Laptop / lid',(0,-1.19,.74),(1.28,.08,.47),material('Shell |'),.07))
laptop.append(box('Laptop / badge',(0,-1.236,.74),(.20,.015,.13),material('Signal | ForgeBadger'),.02))
for i in range(4):
    laptop.append(box('Laptop / key row',(0,-.76-i*.075,.554),(.87,.026,.008),material('Joint |'),.003))

typing_parts=[]
def limb(name,a,b,r,mat):
    a,b=Vector(a),Vector(b)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=10,location=(a+b)/2)
    o=bpy.context.object;o.name=name;o.scale=(r,r,(b-a).length/2+r*.25)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    o.data.materials.append(mat)
    for p in o.data.polygons:p.use_smooth=True
    typing_parts.append(o)
    return o
for side in [-1,1]:
    shoulder=(side*.68,0,1.14);elbow=(side*.78,-.40,.87);hand=(side*.43,-.84,.61)
    limb('Typing / upper',shoulder,elbow,.17,material('Shell |'))
    limb('Typing / forearm',elbow,hand,.15,material('Trim |'))
    palm=box('Typing / hand',hand,(.24,.22,.13),material('Joint |'))
    typing_parts.append(palm)
arm_parts=[o for o in objects if o.parent in [leftarm,rightarm]]

def reset():
    for o,matrix in base.items():o.matrix_basis=matrix.copy()
    for o in laptop+typing_parts:o.hide_render=True
    for o in arm_parts:o.hide_render=False

def sit(phase=0):
    # Lower torso with its arms/head, and extend feet in front of the body.
    for o in [body,head,leftarm,rightarm,obj('Neck actuator')]:o.location.z-=.58
    for leg in [leftleg,rightleg]:
        leg.location.z-=.40;leg.rotation_euler.x=-math.radians(66)
    leftarm.rotation_euler.x=-.65+phase*.10
    leftarm.rotation_euler.y=-.30
    rightarm.rotation_euler.x=-.65-phase*.10
    rightarm.rotation_euler.y=-1.45
    for o in laptop+typing_parts:o.hide_render=False
    for o in arm_parts:o.hide_render=True
    for i,o in enumerate(typing_parts):
        if o.name.startswith("Typing / hand"):
            o.location.z=.61+(.04 if (i<3)==(phase>0) else 0)
    head.rotation_euler.x=math.radians(8)

def render(name):
    bpy.context.view_layer.update()
    scene.render.filepath=str(OUT/(name+'.png'))
    bpy.ops.render.render(write_still=True)

for name in ['stand','blink','walk1','walk2','sit1','sit2','sitBlink']:
    reset()
    if name.startswith('walk'):
        phase=1 if name=='walk1' else -1
        leftleg.rotation_euler.x=.30*phase;rightleg.rotation_euler.x=-.30*phase
        leftarm.rotation_euler.x=-.24*phase;rightarm.rotation_euler.y=-.7
        rightarm.rotation_euler.x=.24*phase
        root.location.z=.08
    if name.startswith('sit'):sit(1 if name=='sit2' else -1)
    if name in ['blink','sitBlink']:
        for eye in eyes:eye.scale.z*=.12
    render(name)
reset()
(OUT/'complete.json').write_text(json.dumps({'frames':7,'size':192,'samples':32})+'\n')
# Restore the original authoring scene without overwriting the source blend.
for s in bpy.data.scenes:
    if s!=scene and not s.name.startswith('FB01 • Web sprites'):
        bpy.context.window.scene=s;break
print('FB01_SPRITES_COMPLETE')
