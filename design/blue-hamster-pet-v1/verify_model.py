"""Verify the saved asset and rendered outputs in an independent Blender process."""
import hashlib
import json
from pathlib import Path

import bpy
import numpy as np


root = Path(__file__).resolve().parent
assert Path(bpy.data.filepath).resolve() == root / "blue-hamster.blend"
assert bpy.context.scene.render.engine == "CYCLES"
assert bpy.context.scene.camera is not None
head = bpy.data.objects["HEAD | gentle curious tilt"]
assert abs(head.matrix_world.translation.z - 2.62) < .001
assert bpy.data.images["reference.png"].packed_file is not None
missing_images = [image.name for image in bpy.data.images
                  if image.source == "FILE" and not image.packed_file
                  and not Path(bpy.path.abspath(image.filepath)).exists()]
assert not missing_images, missing_images

grooms = [obj for obj in bpy.data.objects if obj.type == "CURVES"]
assert len(grooms) == 6
strands = sum(len(obj.data.curves) for obj in grooms)
metadata = json.loads((root / "model-info.json").read_text())
assert strands == metadata["total_hair_strands"]
for obj in grooms:
    data = obj.data
    coordinates = np.empty(len(data.points) * 3, dtype=np.float32)
    data.attributes["position"].data.foreach_get("vector", coordinates)
    assert np.isfinite(coordinates).all(), obj.name
    assert float(np.abs(coordinates).max()) < 5, obj.name
    radius = np.empty(len(data.points), dtype=np.float32)
    data.attributes["radius"].data.foreach_get("value", radius)
    assert (radius > 0).all() and (radius < .01).all(), obj.name
    assert "fur_color" in data.attributes

images = {}
for name, dimensions in {"hero.png": (1200, 1200), "front.png": (1000, 1100),
                         "rear.png": (1000, 1100), "pet-transparent.png": (1024, 1024)}.items():
    path = root / name
    assert path.is_file(), name
    image = bpy.data.images.load(str(path), check_existing=False)
    assert tuple(image.size) == dimensions, (name, image.size[:])
    values = np.empty(dimensions[0] * dimensions[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(values)
    pixels = values.reshape(dimensions[1], dimensions[0], 4)
    assert np.isfinite(pixels).all()
    assert pixels[:, :, :3].std() > .03, f"Blank image: {name}"
    alpha = pixels[:, :, 3]
    if name == "pet-transparent.png":
        assert float(alpha.min()) == 0 and float(alpha.max()) > .99
        assert ((alpha > 0) & (alpha < 1)).sum() > 100
        assert max(alpha[0].max(), alpha[-1].max(), alpha[:, 0].max(), alpha[:, -1].max()) == 0
    else:
        assert float(alpha.min()) > .99
    images[name] = {"dimensions": dimensions, "bytes": path.stat().st_size,
                    "alpha_min": float(alpha.min()), "alpha_max": float(alpha.max()),
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    bpy.data.images.remove(image)

result = {"passed": True, "blender": bpy.app.version_string, "saved_file_reopened": True,
          "packed_reference": True, "missing_external_images": missing_images,
          "hair_strands": strands, "finite_hair_geometry": True, "head_pivot_verified": True,
          "images": images, "rigged": False, "runtime_integrated": False}
(root / "verification.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2), flush=True)
