"""
Fix VRM 0.x structure for VSeeFace compatibility.
Issues found:
1. No skeleton root in skin
2. Spine/chest bone mapping is inverted (Spine02 is parent of Spine01 in hierarchy)
3. Need proper scene structure
"""
import json
import struct
import os

VRM_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Meshy_AI_Character_output.vrm")
OUTPUT_PATH = VRM_PATH  # overwrite

# Read glTF binary
with open(VRM_PATH, 'rb') as f:
    f.read(12)
    json_length = struct.unpack('<I', f.read(4))[0]
    f.read(4)
    json_data = f.read(json_length).decode('utf-8')
    bin_length = struct.unpack('<I', f.read(4))[0]
    f.read(4)
    bin_data = f.read(bin_length)

gltf = json.loads(json_data)

nodes = gltf['nodes']
skins = gltf['skins']
vrm = gltf['extensions']['VRM']

# Fix 1: Set skeleton root on skin (Hips = node 24)
skins[0]['skeleton'] = 24
print("[Fix] Set skin skeleton root to node 24 (Hips)")

# Fix 2: Fix spine/chest mapping
# Node hierarchy: Hips(24) -> Spine02(23) -> Spine01(22) -> Spine(21)
# In VRM humanoid: hips -> spine -> chest -> (neck)
# So the correct mapping should be:
#   hips = Hips (node 24) - root
#   spine = Spine02 (node 23) - first child of hips (in the spine chain)
#   chest = Spine01 (node 22) - child of spine02
#   (then Spine node 21 has shoulders and neck)
# Actually looking at hierarchy:
#   Hips(24) -> children: [LeftUpLeg(4), RightUpLeg(8), Spine02(23)]
#   Spine02(23) -> children: [Spine01(22)]
#   Spine01(22) -> children: [Spine(21)]
#   Spine(21) -> children: [LeftShoulder(12), RightShoulder(16), neck(20)]
#
# VRM expects: hips -> spine -> chest -> upperChest(optional) -> neck
# So mapping should be:
#   hips = node 24 (Hips)
#   spine = node 23 (Spine02) - first spine bone after hips
#   chest = node 22 (Spine01) - second spine bone
#   upperChest = node 21 (Spine) - has shoulders, so this is upper chest
#   neck = node 20 (neck)

human_bones = vrm['humanoid']['humanBones']
for bone in human_bones:
    if bone['bone'] == 'spine':
        bone['node'] = 23  # Spine02 (first child of Hips in spine chain)
        print(f"[Fix] spine -> node 23 (Spine02)")
    elif bone['bone'] == 'chest':
        bone['node'] = 22  # Spine01
        print(f"[Fix] chest -> node 22 (Spine01)")

# Add upperChest
human_bones.append({
    "bone": "upperChest",
    "node": 21,  # Spine (has shoulders and neck as children)
    "useDefaultValues": True
})
print("[Fix] Added upperChest -> node 21 (Spine)")

# Fix 3: Add a proper scene root if not present
# Check if there's a scene with root nodes
scenes = gltf.get('scenes', [])
if scenes:
    scene = scenes[0]
    root_nodes = scene.get('nodes', [])
    print(f"[Fix] Scene root nodes: {root_nodes}")
    # Make sure Hips and char1 and Cube are all accessible
    # Add Hips as root if not there
    if 24 not in root_nodes:
        root_nodes.append(24)
    if 25 not in root_nodes:
        root_nodes.append(25)

# Fix 4: Add materialProperties for each material (VRM 0.x requires this)
materials = gltf.get('materials', [])
mat_props = []
for i, mat in enumerate(materials):
    mat_props.append({
        "name": mat.get('name', f'Material_{i}'),
        "shader": "VRM_USE_GLTFSHADER",
        "renderQueue": 2000,
        "keywordMap": {},
        "tagMap": {},
        "floatProperties": {},
        "vectorProperties": {},
        "textureProperties": {}
    })
vrm['materialProperties'] = mat_props
print(f"[Fix] Added {len(mat_props)} materialProperties")

# Fix 5: Ensure exporterVersion is set (some parsers require it)
vrm['exporterVersion'] = "VRM_Addon_for_Blender-2_20_0"
print("[Fix] Set exporterVersion")

# Write fixed file
new_json = json.dumps(gltf, separators=(',', ':'))
new_json_bytes = new_json.encode('utf-8')
# Pad to 4-byte alignment
while len(new_json_bytes) % 4 != 0:
    new_json_bytes += b' '

new_total = 12 + 8 + len(new_json_bytes) + 8 + len(bin_data)

with open(OUTPUT_PATH, 'wb') as f:
    f.write(b'glTF')
    f.write(struct.pack('<I', 2))
    f.write(struct.pack('<I', new_total))
    f.write(struct.pack('<I', len(new_json_bytes)))
    f.write(b'JSON')
    f.write(new_json_bytes)
    f.write(struct.pack('<I', len(bin_data)))
    f.write(b'BIN\x00')
    f.write(bin_data)

print(f"\n✅ Fixed VRM written: {OUTPUT_PATH} ({new_total} bytes)")
print("\nTry loading in VSeeFace now.")
