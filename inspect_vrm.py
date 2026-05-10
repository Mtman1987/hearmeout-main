import json
import struct
import os

VRM_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Meshy_AI_Character_output.vrm")

with open(VRM_PATH, 'rb') as f:
    f.read(12)  # header
    json_length = struct.unpack('<I', f.read(4))[0]
    f.read(4)  # type
    json_data = f.read(json_length).decode('utf-8')

gltf = json.loads(json_data)

# Write pretty JSON for inspection
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vrm_debug.json")
with open(out, 'w') as f:
    json.dump(gltf, f, indent=2)

print(f"Written to {out}")

# Key checks
nodes = gltf.get('nodes', [])
skins = gltf.get('skins', [])
meshes = gltf.get('meshes', [])
vrm = gltf.get('extensions', {}).get('VRM', {})

print(f"\nNodes: {len(nodes)}")
print(f"Skins: {len(skins)}")
print(f"Meshes: {len(meshes)}")

# Check skin joints
if skins:
    skin = skins[0]
    print(f"\nSkin joints: {len(skin.get('joints', []))}")
    print(f"Skin skeleton root: {skin.get('skeleton', 'NOT SET')}")

# Check node hierarchy
print("\nNode list:")
for i, n in enumerate(nodes):
    children = n.get('children', [])
    mesh_ref = n.get('mesh', None)
    skin_ref = n.get('skin', None)
    print(f"  [{i}] {n.get('name','?')} children={children} mesh={mesh_ref} skin={skin_ref}")

# VRM humanoid
print(f"\nVRM humanBones:")
for bone in vrm.get('humanoid', {}).get('humanBones', []):
    node_idx = bone.get('node')
    node_name = nodes[node_idx]['name'] if node_idx < len(nodes) else '?'
    print(f"  {bone['bone']} -> node[{node_idx}] ({node_name})")

# Blend shapes
print(f"\nBlend shape groups:")
for g in vrm.get('blendShapeMaster', {}).get('blendShapeGroups', []):
    print(f"  {g['presetName']}/{g['name']}: binds={g.get('binds', [])}")
