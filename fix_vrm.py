"""
Validate and fix VRM 0.x structure in the exported file.
VRM 0.x requires extensions.VRM at the root glTF level.
"""
import json
import struct
import os

VRM_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Meshy_AI_Character_output.vrm")

# Read glTF binary
with open(VRM_PATH, 'rb') as f:
    # Header: magic(4) + version(4) + length(4)
    magic = f.read(4)
    version = struct.unpack('<I', f.read(4))[0]
    total_length = struct.unpack('<I', f.read(4))[0]
    
    print(f"Magic: {magic}, glTF version: {version}, total: {total_length}")
    
    # JSON chunk: length(4) + type(4) + data
    json_length = struct.unpack('<I', f.read(4))[0]
    json_type = f.read(4)
    json_data = f.read(json_length).decode('utf-8')
    
    # Binary chunk
    bin_length = struct.unpack('<I', f.read(4))[0]
    bin_type = f.read(4)
    bin_data = f.read(bin_length)

print(f"JSON chunk: {json_length} bytes")
print(f"Binary chunk: {bin_length} bytes")

# Parse JSON
gltf = json.loads(json_data)

# Check extensions
extensions = gltf.get('extensions', {})
extensions_used = gltf.get('extensionsUsed', [])

print(f"\nextensionsUsed: {extensions_used}")
print(f"extensions keys: {list(extensions.keys())}")

if 'VRM' in extensions:
    print("\n✅ VRM 0.x extension found at root level")
    vrm = extensions['VRM']
    print(f"  VRM keys: {list(vrm.keys())}")
    if 'specVersion' in vrm:
        print(f"  specVersion: {vrm['specVersion']}")
    if 'meta' in vrm:
        print(f"  meta: {vrm['meta']}")
    if 'humanoid' in vrm:
        bones = vrm['humanoid'].get('humanBones', [])
        print(f"  humanoid bones: {len(bones)}")
    if 'blendShapeMaster' in vrm:
        groups = vrm['blendShapeMaster'].get('blendShapeGroups', [])
        print(f"  blendShapeGroups: {len(groups)}")
        for g in groups[:3]:
            print(f"    - {g.get('presetName', '?')}: {g.get('name', '?')}")
else:
    print("\n❌ No VRM extension at root level!")
    print("  This is why VSeeFace rejects it.")
    
    # Check if VRMC_vrm exists (VRM 1.0)
    if 'VRMC_vrm' in extensions:
        print("  Found VRMC_vrm (VRM 1.0) - need to convert to VRM 0.x structure")
    
    # We need to ADD the VRM extension
    # Build VRM 0.x extension from scratch based on the glTF data
    print("\n  Attempting to build VRM 0.x extension...")
    
    # Find the armature/skeleton nodes
    nodes = gltf.get('nodes', [])
    skins = gltf.get('skins', [])
    meshes = gltf.get('meshes', [])
    
    # Build humanoid bone list
    bone_map = {
        "hips": "Hips", "spine": "Spine01", "chest": "Spine02",
        "neck": "neck", "head": "Head",
        "leftUpperLeg": "LeftUpLeg", "leftLowerLeg": "LeftLeg",
        "leftFoot": "LeftFoot", "leftToes": "LeftToeBase",
        "rightUpperLeg": "RightUpLeg", "rightLowerLeg": "RightLeg",
        "rightFoot": "RightFoot", "rightToes": "RightToeBase",
        "leftShoulder": "LeftShoulder", "leftUpperArm": "LeftArm",
        "leftLowerArm": "LeftForeArm", "leftHand": "LeftHand",
        "rightShoulder": "RightShoulder", "rightUpperArm": "RightArm",
        "rightLowerArm": "RightForeArm", "rightHand": "RightHand",
    }
    
    # Find node indices by name
    node_name_to_idx = {n.get('name', ''): i for i, n in enumerate(nodes)}
    
    human_bones = []
    for vrm_bone, node_name in bone_map.items():
        if node_name in node_name_to_idx:
            human_bones.append({
                "bone": vrm_bone,
                "node": node_name_to_idx[node_name],
                "useDefaultValues": True
            })
    
    # Build blend shape groups from morph targets
    blend_shape_groups = []
    preset_map = {
        "Blink_L": "blink_l", "Blink_R": "blink_r",
        "A": "a", "I": "i", "U": "u", "E": "e", "O": "o",
        "Joy": "joy", "Angry": "angry", "Sorrow": "sorrow",
        "Surprised": "fun",
        "LookUp": "lookup", "LookDown": "lookdown",
        "LookLeft": "lookleft", "LookRight": "lookright",
    }
    
    # Find mesh with morph targets
    for mesh_idx, mesh in enumerate(meshes):
        for prim in mesh.get('primitives', []):
            targets = prim.get('targets', [])
            target_names = mesh.get('extras', {}).get('targetNames', [])
            if not target_names:
                target_names = prim.get('extras', {}).get('targetNames', [])
            
            if target_names:
                print(f"  Found morph targets on mesh {mesh_idx}: {target_names}")
                for t_idx, t_name in enumerate(target_names):
                    if t_name in preset_map:
                        # Find the node that references this mesh
                        mesh_node_idx = None
                        for n_idx, node in enumerate(nodes):
                            if node.get('mesh') == mesh_idx:
                                mesh_node_idx = n_idx
                                break
                        
                        blend_shape_groups.append({
                            "presetName": preset_map[t_name],
                            "name": t_name,
                            "binds": [{
                                "mesh": mesh_idx,
                                "index": t_idx,
                                "weight": 100
                            }],
                            "materialValues": [],
                            "isBinary": False
                        })
    
    # Build VRM 0.x extension
    vrm_extension = {
        "specVersion": "0.0",
        "meta": {
            "title": "Meshy AI Character",
            "version": "1.0",
            "author": "StreamWeaver",
            "contactInformation": "",
            "reference": "",
            "allowedUserName": "Everyone",
            "violentUssageName": "Disallow",
            "sexualUssageName": "Disallow",
            "commercialUssageName": "Allow",
            "otherPermissionUrl": "",
            "licenseName": "Other",
            "otherLicenseUrl": ""
        },
        "humanoid": {
            "humanBones": human_bones,
            "armStretch": 0.05,
            "legStretch": 0.05,
            "upperArmTwist": 0.5,
            "lowerArmTwist": 0.5,
            "upperLegTwist": 0.5,
            "lowerLegTwist": 0.5,
            "feetSpacing": 0,
            "hasTranslationDoF": False
        },
        "blendShapeMaster": {
            "blendShapeGroups": blend_shape_groups
        },
        "firstPerson": {
            "firstPersonBone": node_name_to_idx.get("Head", 0),
            "firstPersonBoneOffset": {"x": 0, "y": 0.06, "z": 0},
            "meshAnnotations": [],
            "lookAtTypeName": "Bone",
            "lookAtHorizontalInner": {"curve": [0,0,0,1,1,1,1,0], "xRange": 90, "yRange": 10},
            "lookAtHorizontalOuter": {"curve": [0,0,0,1,1,1,1,0], "xRange": 90, "yRange": 10},
            "lookAtVerticalDown": {"curve": [0,0,0,1,1,1,1,0], "xRange": 90, "yRange": 10},
            "lookAtVerticalUp": {"curve": [0,0,0,1,1,1,1,0], "xRange": 90, "yRange": 10}
        },
        "secondaryAnimation": {
            "boneGroups": [],
            "colliderGroups": []
        },
        "materialProperties": []
    }
    
    # Add/replace extension
    if 'extensions' not in gltf:
        gltf['extensions'] = {}
    gltf['extensions']['VRM'] = vrm_extension
    
    # Remove VRM 1.0 if present
    if 'VRMC_vrm' in gltf.get('extensions', {}):
        del gltf['extensions']['VRMC_vrm']
    
    # Update extensionsUsed
    if 'extensionsUsed' not in gltf:
        gltf['extensionsUsed'] = []
    if 'VRM' not in gltf['extensionsUsed']:
        gltf['extensionsUsed'].append('VRM')
    if 'VRMC_vrm' in gltf['extensionsUsed']:
        gltf['extensionsUsed'].remove('VRMC_vrm')
    
    print(f"\n  Built VRM 0.x extension:")
    print(f"    humanBones: {len(human_bones)}")
    print(f"    blendShapeGroups: {len(blend_shape_groups)}")
    
    # Write fixed file
    new_json = json.dumps(gltf, separators=(',', ':'))
    new_json_bytes = new_json.encode('utf-8')
    # Pad to 4-byte alignment
    while len(new_json_bytes) % 4 != 0:
        new_json_bytes += b' '
    
    new_total = 12 + 8 + len(new_json_bytes) + 8 + len(bin_data)
    
    output_path = VRM_PATH  # overwrite
    with open(output_path, 'wb') as f:
        # Header
        f.write(b'glTF')
        f.write(struct.pack('<I', 2))
        f.write(struct.pack('<I', new_total))
        # JSON chunk
        f.write(struct.pack('<I', len(new_json_bytes)))
        f.write(b'JSON')
        f.write(new_json_bytes)
        # Binary chunk
        f.write(struct.pack('<I', len(bin_data)))
        f.write(b'BIN\x00')
        f.write(bin_data)
    
    print(f"\n✅ Fixed VRM 0.x file written: {output_path}")
    print(f"   Size: {new_total} bytes")
