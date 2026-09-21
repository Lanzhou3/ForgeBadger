"""Reference-led, editable Blender reconstruction of the silver-blue hamster.

The character surfaces, pose, hands, garment and optics are newly constructed.
Run only in an independent Blender process; this script clears that scene.
"""
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
sys.path.insert(0, str(ROOT))
from blender_helpers import (area, assign, cube, curve, emit_material, fur_material,
                             linear, look_at, material, mesh, move_collection,
                             new_collection, new_empty, normalize, parent_keep, uv)

parser = argparse.ArgumentParser()
parser.add_argument("--preview", action="store_true")
parser.add_argument("--render-only", action="store_true")
parser.add_argument("--gpu", action="store_true", help="Use a detected Metal device for this process only")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
rng = np.random.default_rng(202609202)
started = time.time()
groom_counts = {}


def log(message):
    print(f"[Reference model {time.time()-started:.1f}s] {message}", flush=True)


# z, half-width, half-depth, depth offset. Cheeks form one continuous face.
HEAD_PROFILE = [
    (1.91, .01, .02, -.025), (2.02, .49, .37, -.045),
    (2.20, .83, .59, -.055), (2.43, 1.015, .69, -.055),
    (2.65, .985, .71, -.04), (2.87, .86, .65, -.025),
    (3.09, .75, .54, .005), (3.28, .59, .39, .03),
    (3.43, .22, .17, .035), (3.46, .005, .005, .035),
]
BODY_PROFILE = [
    (.11, .06, .07, .11), (.22, .55, .43, .11),
    (.46, .85, .67, .11), (.82, 1.015, .795, .09),
    (1.15, 1.005, .80, .07), (1.49, .905, .75, .04),
    (1.80, .755, .65, .01), (2.04, .605, .52, -.01),
    (2.25, .36, .32, -.015), (2.36, .005, .005, -.015),
]


def profile(z, rows):
    i = max(0, min(len(rows)-2, int(np.searchsorted([r[0] for r in rows], z))-1))
    a, b = np.array(rows[i], float), np.array(rows[i+1], float)
    before, after = np.array(rows[max(0, i-1)], float), np.array(rows[min(len(rows)-1, i+2)], float)
    t = np.clip((z-a[0])/(b[0]-a[0]), 0, 1)
    m0 = (b[1:]-before[1:]) / (b[0]-before[0])
    m1 = (after[1:]-a[1:]) / (after[0]-a[0])
    result = ((2*t**3-3*t*t+1)*a[1:] + (t**3-2*t*t+t)*(b[0]-a[0])*m0
              + (-2*t**3+3*t*t)*b[1:] + (t**3-t*t)*(b[0]-a[0])*m1)
    result[:2] = np.maximum(result[:2], .003)
    return result


def head_surface(z, theta):
    rx, ry, cy = profile(z, HEAD_PROFILE)
    x = rx * math.sin(theta)
    front = max(0, math.cos(theta))**5
    cheek = .105 * (math.exp(-((x-.48)/.36)**2) + math.exp(-((x+.48)/.36)**2)) * math.exp(-((z-2.40)/.33)**2)
    muzzle = .24 * math.exp(-(x/.30)**2 - ((z-2.55)/.20)**2)
    y = cy - ry*math.cos(theta) - front*(cheek+muzzle)
    return Vector((x, y, z))


def body_surface(z, theta, offset=0):
    rx, ry, cy = profile(z, BODY_PROFILE)
    return Vector(((rx+offset)*math.sin(theta), cy-(ry+offset)*math.cos(theta), z))


def lathe_surface(name, rows, evaluate, mat, col):
    rings, sides = 100, 128
    verts = [evaluate(z, j*math.tau/sides) for z in np.linspace(rows[0][0], rows[-1][0], rings+1) for j in range(sides)]
    faces = []
    for i in range(rings):
        for j in range(sides):
            a, b = i*sides+j, i*sides+(j+1)%sides
            faces.append((a, b, b+sides, a+sides))
    faces.extend([tuple(range(sides-1, -1, -1)), tuple(rings*sides+j for j in range(sides))])
    obj = mesh(name, verts, faces, mat, col)
    bpy.context.view_layer.objects.active = obj
    sub = obj.modifiers.new("Continuous sculpt finish", "SUBSURF")
    sub.levels = 1
    bpy.ops.object.modifier_apply(modifier=sub.name)
    return obj


def front_edge(z):
    return .37 + .70*max(0,(z-1.57)/.55) + .25*max(0,(1.57-z)/.45)**2


def in_armhole(theta, z):
    return ((abs(theta)-1.40)/.42)**2 + ((z-1.87)/.29)**2 < 1


def groom(obj, count, length, region, collection, mat):
    obj.data.calc_loop_triangles()
    verts = np.array([v.co[:] for v in obj.data.vertices], np.float32)
    normals = np.array([v.normal[:] for v in obj.data.vertices], np.float32)
    ids = np.array([t.vertices[:] for t in obj.data.loop_triangles])
    triangles = verts[ids]
    areas = np.linalg.norm(np.cross(triangles[:,1]-triangles[:,0], triangles[:,2]-triangles[:,0]), axis=1).astype(float)
    chosen = rng.choice(len(ids), count, p=areas/areas.sum())
    uv_samples = rng.random((count,2))
    uv_samples[uv_samples.sum(axis=1)>1] = 1-uv_samples[uv_samples.sum(axis=1)>1]
    bary = np.column_stack((1-uv_samples.sum(axis=1), uv_samples))
    p = np.einsum("ni,nij->nj", bary, triangles[chosen])
    n = normalize(np.einsum("ni,nij->nj", bary, normals[ids[chosen]]))
    keep = np.ones(count, bool)
    if region == "head":
        for sign in (-1,1):
            eye = ((p[:,0]-sign*.34)/.127)**2 + ((p[:,2]-2.835)/.149)**2
            keep &= ~((eye<1) & (p[:,1]<-.53))
        keep &= ~((abs(p[:,0])<.105) & (abs(p[:,2]-2.565)<.075) & (p[:,1]<-.94))
    elif region == "body":
        zs=np.array([r[0] for r in BODY_PROFILE])
        rx=np.interp(p[:,2],zs,[r[1] for r in BODY_PROFILE])
        ry=np.interp(p[:,2],zs,[r[2] for r in BODY_PROFILE])
        cy=np.interp(p[:,2],zs,[r[3] for r in BODY_PROFILE])
        theta = np.arctan2(p[:,0]/rx, -(p[:,1]-cy)/ry)
        edge = .37+.70*np.maximum(0,(p[:,2]-1.57)/.55)+.25*np.maximum(0,(1.57-p[:,2])/.45)**2
        hole = ((abs(theta)-1.40)/.42)**2 + ((p[:,2]-1.87)/.29)**2 < 1
        covered = (p[:,2]>1.12) & (p[:,2]<2.12) & (abs(theta)>edge) & ~hole
        keep &= ~covered
    p, n = p[keep], n[keep]
    count = len(p)
    flow = np.zeros_like(p)
    flow[:,0], flow[:,2] = .22*p[:,0], -.8
    if region == "head":
        flow[:,0] = p[:,0]*1.25
        flow[:,2] = (p[:,2]-2.58)*.8-.12
    if region == "arm":
        flow[:,0] = -np.sign(p[:,0])*.75
        flow[:,2] = -.23
    tangent = normalize(flow-n*(flow*n).sum(axis=1)[:,None])
    curl = normalize(rng.normal(size=p.shape))
    lengths = length*rng.uniform(.68,1.22,count)
    flyaways = rng.random(count)<.025
    lengths[flyaways] *= 1.45
    if region == "head":
        near_muzzle = (abs(p[:,0])<.38) & (p[:,1]<-.75) & (abs(p[:,2]-2.57)<.24)
        lengths[near_muzzle] *= .42
        lengths[(p[:,2]>2.83) & (p[:,1]<-.50)] *= .66
    t = np.linspace(0,1,6)
    coords = p[:,None,:] + n[:,None,:]*.001
    coords = coords + lengths[:,None,None]*(n[:,None,:]*(t-.55*t*t)[None,:,None]
                 + tangent[:,None,:]*(.72*t*t)[None,:,None]
                 + curl[:,None,:]*(.055*np.sin(t*math.tau))[None,:,None])
    data = bpy.data.hair_curves.new(obj.name+" groom")
    data.add_curves([6]*count)
    data.attributes["position"].data.foreach_set("vector", coords.astype(np.float32).ravel())
    widths = rng.uniform(.00075,.00135,count)[:,None]*np.array([.9,1,.85,.65,.36,.015])[None,:]
    radius = data.attributes.new("radius","FLOAT","POINT")
    radius.data.foreach_set("value", widths.astype(np.float32).ravel())
    silver = np.array(linear((.77,.795,.825)))
    pearl = np.array(linear((.93,.92,.9)))
    frontness = np.clip((-p[:,1]-.05)/.70,0,1)
    if region == "head":
        white = frontness*np.clip((3.10-p[:,2])/.60,0,1)
    else:
        white = frontness*np.clip(1-abs(p[:,0])/.98,0,1)
    colors = silver[None,:]*(1-white[:,None]) + pearl[None,:]*white[:,None]
    colors *= rng.uniform(.83,1.1,(count,1))
    colors = np.column_stack((np.clip(colors,0,1), np.ones(count)))
    tint = data.attributes.new("fur_color","FLOAT_COLOR","POINT")
    tint.data.foreach_set("color", np.repeat(colors,6,axis=0).astype(np.float32).ravel())
    out = bpy.data.objects.new(obj.name+" | groomed fur",data)
    collection.objects.link(out)
    assign(out,mat)
    groom_counts[obj.name] = count
    log(f"Groomed {obj.name}: {count:,}")
    return out


def build_ear(sign, col, skin, outer):
    center = Vector((sign*.69,.015,3.245))
    def point(r,a,inside=False):
        # Folded lower root and fuller upper ear, rather than a circular disc.
        sx = .25*(.83+.17*math.sin(a))
        x,z = sx*r*math.cos(a), .31*r*math.sin(a)
        angle = -sign*.24
        y = -.045 + .14*(1-r*r) + .025*math.sin(a)*r
        return center+Vector((x*math.cos(angle)+z*math.sin(angle), y-(.012 if inside else 0), -x*math.sin(angle)+z*math.cos(angle)))
    for inner,maxr,mat in [(False,1,outer),(True,.90,skin)]:
        verts = [point(.001,0,inner)]
        for ring in range(1,18):
            verts.extend(point(maxr*ring/17,j*math.tau/80,inner) for j in range(80))
        faces = [(0,j+1,(j+1)%80+1) for j in range(80)]
        for ring in range(16):
            for j in range(80):
                a,b=1+ring*80+j,1+ring*80+(j+1)%80
                faces.append((a,a+80,b+80,b))
        obj=mesh(f"Ear {sign} | {'blush inner bowl' if inner else 'sculpted outer cartilage'}",verts,faces,mat,col)
        solid=obj.modifiers.new("Cartilage thickness","SOLIDIFY")
        solid.thickness=.008 if inner else .028
    rim=[point(.97,a) for a in np.linspace(0,math.tau,70,endpoint=False)]
    curve(f"Ear {sign} | soft rounded helix",rim,.0045,outer,col,True)
    # A restrained fine hair fringe at the real outer rim.
    for j in range(200):
        a = rng.uniform(0,math.tau)
        p=point(rng.uniform(.92,1),a)
        direction=Vector((math.cos(a),-.25,math.sin(a)))
        end=p+direction*rng.uniform(.012,.026)
        hair=curve(f"Ear {sign} | rim hair {j:03}",[p,p.lerp(end,.55),end],.0006,WHISKER,col)
        for k,bp in enumerate(hair.data.splines[0].bezier_points):
            bp.radius=[.9,.6,.02][k]


def jacket(col):
    for sign in (-1,1):
        nr,nc=44,76
        verts=[]
        for i in range(nr+1):
            v=i/nr
            for j in range(nc+1):
                u=j/nc
                z=1.12+1.00*v+.045*math.sin(math.pi*u)*(1-v)
                theta=front_edge(z)+(math.pi-front_edge(z))*u
                p=body_surface(z,sign*theta,.042)
                verts.append(p)
        faces=[]
        for i in range(nr):
            z=1.12+(i+.5)/nr
            for j in range(nc):
                theta=front_edge(z)+(math.pi-front_edge(z))*(j+.5)/nc
                if in_armhole(theta,z):
                    continue
                a=i*(nc+1)+j
                face=(a,a+1,a+nc+2,a+nc+1)
                faces.append(face if sign>0 else face[::-1])
        panel=mesh(f"Vest {sign} | curved front and sleeveless armhole",verts,faces,TEXTILE,col)
        solid=panel.modifiers.new("Padded textile shell","SOLIDIFY")
        solid.thickness=.022
        bevel=panel.modifiers.new("Soft garment edges","BEVEL")
        bevel.width=.017
        bevel.segments=3
        edge=[body_surface(z,sign*front_edge(z),.048) for z in np.linspace(1.12,2.12,32)]
        curve(f"Vest {sign} | curved front binding",edge,.016,TRIM,col)
        curve(f"Vest {sign} | hem",verts[:nc+1],.014,TRIM,col)
        curve(f"Vest {sign} | collar",verts[-nc-1:],.014,TRIM,col)
        opening=[]
        for a in np.linspace(0,math.tau,60,endpoint=False):
            theta,z=1.40+.42*math.cos(a),1.87+.29*math.sin(a)
            if z<2.12:
                opening.append(body_surface(z,sign*theta,.048))
        curve(f"Vest {sign} | armhole binding",opening,.014,TRIM,col)
        light_path=[]
        for z in np.linspace(1.67,1.96,12):
            p=body_surface(z,sign*(front_edge(z)+.11),.072)
            light_path.append(p)
        curve(f"Vest {sign} | light inset bezel",light_path,.032,TRIM,col)
        curve(f"Vest {sign} | cyan strip",[p+Vector((0,-.032,0)) for p in light_path],.013,CYAN,col)
        for i,z in enumerate(np.linspace(1.17,1.59,28)):
            p=body_surface(z,sign*(front_edge(z)+.048),.057)
            p2=body_surface(z+.008,sign*(front_edge(z+.008)+.048),.057)
            curve(f"Vest {sign} | sewn stitch {i:02}",[p,p2],.0021,THREAD,col)


def arm(sign,col):
    p0,p1,p2,p3=[Vector(p) for p in [(sign*.75,-.24,1.91),(sign*.96,-.49,1.32),
                                    (sign*.75,-.78,1.33),(sign*.315,-.84,1.445)]]
    verts,faces=[],[]
    rows,sides=56,40
    for i in range(rows+1):
        t=i/rows
        center=(1-t)**3*p0+3*(1-t)**2*t*p1+3*(1-t)*t*t*p2+t**3*p3
        tangent=(3*(1-t)**2*(p1-p0)+6*t*(1-t)*(p2-p1)+3*t*t*(p3-p2)).normalized()
        u=tangent.cross(Vector((0,1,0))).normalized()
        v=tangent.cross(u).normalized()
        radius=(.145+.075*math.sin(math.pi*t)-.065*t)*max(.07,math.sin(math.pi*(.02+.96*t))**.13)
        for j in range(sides):
            a=j*math.tau/sides
            verts.append(center+radius*(math.cos(a)*u+math.sin(a)*v))
    for i in range(rows):
        for j in range(sides):
            a,b=i*sides+j,i*sides+(j+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces.extend([tuple(range(sides-1,-1,-1)),tuple(rows*sides+j for j in range(sides))])
    return mesh(f"Forearm {sign} | inward resting pose",verts,faces,COAT,col)


def hands_feet(sign,col):
    uv(f"Paw {sign} | soft pink palm",(sign*.292,-.86,1.443),(.108,.061,.068),SKIN,col)
    for i in range(4):
        start=Vector((sign*(.27+.026*i),-.900,1.474-.033*i))
        end=Vector((sign*(.16+.016*i),-.927,1.412-.023*i))
        middle=start.lerp(end,.55)+Vector((0,-.014,.012))
        finger=curve(f"Paw {sign} | inward finger {i+1}",[start,middle,end],.019-.0012*i,SKIN,col)
        for k,p in enumerate(finger.data.splines[0].bezier_points):
            p.radius=[1,.88,.52][k]
        uv(f"Paw {sign} | tiny nail {i+1}",end+Vector((0,-.007,.005)),(.012,.005,.014),NAIL,col,segments=16,rings=12)
    curve(f"Paw {sign} | thumb",[(sign*.27,-.866,1.488),(sign*.21,-.918,1.489),(sign*.194,-.932,1.46)],.020,SKIN,col)
    uv(f"Foot {sign} | instep",(sign*.52,-.29,.105),(.165,.265,.085),SKIN,col)
    for i in range(4):
        x=sign*(.404+.068*i)
        end=Vector((x+sign*.009,-.615+.025*abs(i-1.5),.066))
        toe=curve(f"Foot {sign} | toe {i+1}",[(x,-.42,.097),(x,-.53,.087),end],.027,SKIN,col)
        for k,p in enumerate(toe.data.splines[0].bezier_points):
            p.radius=[1,.85,.42][k]
        uv(f"Foot {sign} | subtle claw {i+1}",end+Vector((0,-.005,.008)),(.015,.021,.007),NAIL,col,segments=16,rings=12)


def eyewear(col):
    def point(x,v):
        u=abs(x)/.755
        low=3.07+.14*math.exp(-(x/.26)**2)+.01*u
        high=3.445-.225*u*u
        z=low*(1-v)+high*v
        return Vector((x,-.64+.30*u*u+.10*v,z))
    nx,ny=96,18
    verts=[point(-.755+1.51*i/nx,j/ny) for j in range(ny+1) for i in range(nx+1)]
    faces=[]
    for j in range(ny):
        for i in range(nx):
            a=j*(nx+1)+i
            faces.append((a,a+1,a+nx+2,a+nx+1))
    lens=mesh("AR goggles | bowed continuous transparent lens",verts,faces,GLASS,col)
    solid=lens.modifiers.new("Optical polymer thickness","SOLIDIFY")
    solid.thickness=.009
    outline=[point(x,0) for x in np.linspace(-.755,.755,40)]
    outline += [point(.755,v) for v in np.linspace(0,1,5)[1:]]
    outline += [point(x,1) for x in np.linspace(.755,-.755,40)[1:]]
    outline += [point(-.755,v) for v in np.linspace(1,0,5)[1:-1]]
    curve("AR goggles | titanium rim",outline,.019,METAL,col,True)
    curve("AR goggles | cyan rim guide",[p+Vector((0,-.018,0)) for p in outline],.006,CYAN,col,True)
    for sign in (-1,1):
        hinge=cube(f"AR goggles {sign} | compact side hinge",(sign*.777,-.30,3.12),(.085,.13,.105),METAL,col,.018)
        curve(f"AR goggles {sign} | side arm",[(sign*.775,-.27,3.12),(sign*.91,-.03,3.11),
              (sign*.91,.22,3.04),(sign*.83,.35,2.99)],.026,METAL,col)
        for x in (.48,.64):
            p=point(sign*x,.83)+Vector((0,-.022,0))
            uv(f"AR goggles {sign} | optical indicator {x}",p,(.023,.006,.012),WHITE_LIGHT,col,segments=20,rings=12)


def face_details(col):
    for sign in (-1,1):
        x,z=sign*.34,2.835
        rx=profile(z,HEAD_PROFILE)[0]
        surface=head_surface(z,math.asin(x/rx))
        center=surface+Vector((0,-.016,0))
        uv(f"Eye {sign} | deep inset brown-black eye",center,(.133,.091,.156),EYE,col,
           rotation=(0,sign*.09,sign*.13))
        ring=[]
        for a in np.linspace(0,math.tau,56,endpoint=False):
            xx,zz=x+.146*math.cos(a),z+.170*math.sin(a)
            r=profile(zz,HEAD_PROFILE)[0]
            p=head_surface(zz,math.asin(max(-.99,min(.99,xx/r))))
            p.y-=.013
            ring.append(p)
        build_ear(sign,col,EAR,EAR_OUTER)
    p=head_surface(2.565,0)
    nose=uv("Nose | soft triangular rose nose",p+Vector((0,-.022,.007)),(.105,.066,.073),NOSE,col)
    center_z=p.z+.007
    for vertex in nose.data.vertices:
        t=(vertex.co.z-center_z)/.073
        vertex.co.x *= .66+.43*(t+1)/2
    nose_y=p.y-.022
    for sign in (-1,1):
        curve(f"Nose {sign} | subtle nostril",[(sign*.052,nose_y-.053,2.572),
              (sign*.048,nose_y-.062,2.55),(sign*.035,nose_y-.055,2.535)],.0038,LIP,col)
    mouth_y=head_surface(2.441,0).y-.008
    uv("Mouth | tiny parted opening",(0,mouth_y,2.441),(.028,.009,.012),LIP,col,segments=28,rings=16)
    curve("Muzzle | philtrum",[(0,nose_y-.018,2.508),(0,nose_y+.025,2.472),(0,nose_y+.05,2.456)],.004,LIP,col)
    for sign in (-1,1):
        for i in range(9):
            z=2.49+(i-4)*.021
            a=Vector((sign*(.165+.011*(i%3)),nose_y+.068,z))
            b=Vector((sign*(.93+.065*(i%3)),nose_y+.15+.04*(i%2),z+(i-4)*.065))
            whisker=curve(f"Whisker {sign} | natural tapered strand {i+1}",[a,a.lerp(b,.48)+Vector((0,-.075,.025)),b],.0017,WHISKER,col)
            for j,bp in enumerate(whisker.data.splines[0].bezier_points):
                bp.radius=[1,.68,.015][j]


def render(scene,camera,name,location,size,samples=64,transparent=False):
    camera.location=location
    look_at(camera,(-.035,-.04,1.83))
    scene.render.resolution_x,scene.render.resolution_y=size
    scene.render.resolution_percentage=100
    scene.cycles.samples=samples
    scene.render.film_transparent=transparent
    bpy.data.objects["Studio | floor"].hide_render=transparent
    scene.render.filepath=str(ROOT/name)
    log(f"Rendering {name}")
    bpy.ops.render.render(write_still=True)


if not args.render_only:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)
    body_col=new_collection("01 | Reference-shaped body and inward paws")
    head_col=new_collection("02 | Continuous cheek silhouette and face")
    fur_col=new_collection("03 | Individually groomed native hair")
    vest_col=new_collection("04 | Open fitted woven vest")
    glass_col=new_collection("05 | Raised curved AR optics")
    roots_col=new_collection("06 | Pose controls and packed reference")
    studio_col=new_collection("07 | Studio")
    COAT=material("Coat base | subtle blue silver",(.68,.715,.76),.73,subsurface=.06)
    SKIN=material("Skin | natural pink paws",(.83,.57,.55),.48,subsurface=.22)
    NAIL=material("Claws | translucent warm ivory",(.85,.76,.71),.4,subsurface=.10)
    EAR=material("Ears | warm thin translucent skin",(.72,.50,.50),.57,subsurface=.30)
    EAR_OUTER=material("Ears | muted silver pink outer skin",(.69,.66,.67),.61,subsurface=.14)
    NOSE=material("Nose | soft rose",(.81,.43,.44),.40,subsurface=.20)
    LIP=material("Mouth | muted warm shadow",(.35,.20,.19),.6)
    EYE=material("Eyes | natural glossy brown black",(.030,.025,.021),.125)
    EYE.node_tree.nodes.get("Principled BSDF").inputs["Coat Weight"].default_value=.2
    LID=material("Eyelids | muted warm gray",(.25,.20,.20),.55)
    WHISKER=material("Fine pearl whiskers",(.78,.80,.82),.43)
    METAL=material("Goggles | satin graphite titanium",(.12,.20,.31),.25,.55)
    CYAN=emit_material("Soft cyan optics",(.13,.73,1.0),3.2)
    WHITE_LIGHT=emit_material("Ice blue indicator",(.55,.91,1),4)
    TRIM=material("Vest | soft charcoal binding",(.12,.135,.16),.8)
    THREAD=material("Vest | woven edge stitching",(.31,.33,.36),.85)
    TEXTILE=material("Vest | woven graphite microfiber",(.235,.25,.28),.85)
    nodes=TEXTILE.node_tree.nodes
    tex=nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value=210
    tex.inputs["Detail"].default_value=2
    bump=nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value=.45
    bump.inputs["Distance"].default_value=.012
    TEXTILE.node_tree.links.new(tex.outputs["Fac"],bump.inputs["Height"])
    TEXTILE.node_tree.links.new(bump.outputs["Normal"],nodes.get("Principled BSDF").inputs["Normal"])
    ramp=nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color=(*linear((.145,.16,.185)),1)
    ramp.color_ramp.elements[1].color=(*linear((.29,.30,.32)),1)
    TEXTILE.node_tree.links.new(tex.outputs["Fac"],ramp.inputs["Fac"])
    TEXTILE.node_tree.links.new(ramp.outputs["Color"],nodes.get("Principled BSDF").inputs["Base Color"])
    GLASS=material("Goggles | transparent blue curved polymer",(.38,.70,.94),.075)
    bsdf=GLASS.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Transmission Weight"].default_value=1
    bsdf.inputs["IOR"].default_value=1.43
    trans=GLASS.node_tree.nodes.new("ShaderNodeBsdfTransparent")
    mix=GLASS.node_tree.nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value=.5
    GLASS.node_tree.links.new(bsdf.outputs[0],mix.inputs[1])
    GLASS.node_tree.links.new(trans.outputs[0],mix.inputs[2])
    GLASS.node_tree.links.new(mix.outputs[0],GLASS.node_tree.nodes.get("Material Output").inputs["Surface"])
    FUR=fur_material()
    root=new_empty("CHARACTER ROOT | Silver blue Syrian",(0,0,0),roots_col)
    head_root=new_empty("HEAD POSE | reference clockwise tilt",(0,-.03,2.57),roots_col)
    parent_keep(head_root,root)
    body=lathe_surface("Body | sculpted compact pear silhouette",BODY_PROFILE,body_surface,COAT,body_col)
    head=lathe_surface("Head | single continuous cheek and muzzle surface",HEAD_PROFILE,head_surface,COAT,head_col)
    groom(body,190000,.068,"body",fur_col,FUR)
    head_groom=groom(head,175000,.067,"head",fur_col,FUR)
    face_details(head_col)
    eyewear(glass_col)
    jacket(vest_col)
    for sign in (-1,1):
        limb=arm(sign,body_col)
        groom(limb,25000,.063,"arm",fur_col,FUR)
        hands_feet(sign,body_col)
    for obj in list(head_col.objects)+list(glass_col.objects)+[head_groom]:
        parent_keep(obj,head_root)
    for col in (body_col,fur_col,vest_col):
        for obj in col.objects:
            if obj.parent is None:
                parent_keep(obj,root)
    head_root.rotation_euler[1]=math.radians(14)
    head_root.location.x-=.13
    ref=bpy.data.images.load(str(ROOT/"reference.png"))
    ref.pack()
    ref.use_fake_user=True
    root["reference"]="The exact user-uploaded reference.png, packed in this file"
    root["asset_stage"]="Static editable reconstruction; no rig or application integration"
    root["construction"]="New profile-sculpted meshes, real groom curves, tailored garment and optical lens"
    floor_mat=material("Studio | soft charcoal",(.17,.18,.21),.87)
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.012))
    floor=bpy.context.object
    floor.name="Studio | floor"
    assign(floor,floor_mat)
    move_collection(floor,studio_col)
    area("Studio | large soft key",(-3.6,-4.5,6),470,(1,.96,.91),4.2,studio_col)
    area("Studio | soft fill",(3.6,-4,3.6),190,(.87,.93,1),3.4,studio_col)
    area("Studio | blue rim",(2.5,2.8,4.5),510,(.70,.83,1),3.5,studio_col)
    area("Studio | soft top",(-1,1.5,6),280,(1,.98,.95),3.3,studio_col)
    camera_data=bpy.data.cameras.new("Camera | reference portrait")
    camera=bpy.data.objects.new("Camera | reference portrait",camera_data)
    studio_col.objects.link(camera)
    camera_data.type="ORTHO"
    camera_data.ortho_scale=4.32
    camera.location=(2.1,-11,3.42)
    look_at(camera,(-.035,-.04,1.83))
    scene=bpy.context.scene
    scene.camera=camera
    scene.render.engine="CYCLES"
    scene.cycles.device="CPU"
    scene.cycles.use_denoising=True
    scene.cycles.adaptive_threshold=.03
    scene.cycles.max_bounces=10
    scene.cycles.transmission_bounces=8
    scene.cycles.transparent_max_bounces=12
    scene.render.image_settings.file_format="PNG"
    scene.render.image_settings.color_mode="RGBA"
    scene.render.image_settings.color_depth="8"
    scene.world.use_nodes=True
    scene.world.node_tree.nodes.get("Background").inputs[0].default_value=(.20,.22,.26,1)
    scene.world.node_tree.nodes.get("Background").inputs[1].default_value=.20
    scene.view_settings.view_transform="AgX"
    scene.view_settings.look="AgX - Medium High Contrast"
    scene.render.resolution_x=scene.render.resolution_y=1200
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    bpy.context.view_layer.objects.active=root
    for screen in bpy.data.screens:
        for a in screen.areas:
            if a.type=="VIEW_3D":
                a.spaces.active.region_3d.view_perspective="CAMERA"
                a.spaces.active.shading.type="SOLID"
                a.spaces.active.shading.color_type="MATERIAL"
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/"blue-hamster-v2.blend"))
    (ROOT/"model-info.json").write_text(json.dumps({"blender":bpy.app.version_string,"hair_strands":groom_counts,
         "total_hair_strands":sum(groom_counts.values()),"head_tilt_degrees":14,
         "native_hair_objects":len([o for o in bpy.data.objects if o.type=="CURVES"]),
         "mesh_objects":len([o for o in bpy.data.objects if o.type=="MESH"]),
         "rigged":False,"runtime_integrated":False},indent=2)+"\n")
else:
    scene=bpy.context.scene
    camera=scene.camera

if args.gpu:
    prefs=bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type="METAL"
    prefs.refresh_devices()
    metal=[d for d in prefs.devices if d.type=="METAL"]
    if not metal:
        raise RuntimeError("No Metal device available; rerun without --gpu")
    for device in prefs.devices:
        device.use=device.type=="METAL"
    scene.cycles.device="GPU"
    log("Rendering on Metal: "+", ".join(d.name for d in metal))

if args.preview:
    render(scene,camera,"preview.png",(2.1,-11,3.42),(800,800),32)
else:
    render(scene,camera,"hero.png",(2.1,-11,3.42),(1200,1200),80)
    render(scene,camera,"front.png",(0,-11,3.3),(1000,1100),64)
    render(scene,camera,"rear.png",(4.3,9,3.6),(1000,1100),64)
    render(scene,camera,"pet-transparent.png",(2.1,-11,3.42),(1024,1024),80,True)
log("Finished")
