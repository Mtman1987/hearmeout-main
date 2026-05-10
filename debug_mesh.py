"""Debug: analyze vertex positions around head to calibrate region detection."""
import bpy
import os
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FBX_PATH = os.path.join(SCRIPT_DIR, "Meshy_AI_Character_output.fbx")

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=FBX_PATH)

armature = None
mesh_obj = None
for obj in bpy.context.scene.objects:
    if obj.type == 'ARMATURE':
        armature = obj
    elif obj.type == 'MESH':
        mesh_obj = obj

# Get head bone world position
head_bone = armature.data.bones["Head"]
head_world = armature.matrix_world @ head_bone.head_local
head_tail = armature.matrix_world @ head_bone.tail_local
print(f"Head bone head: {head_world}")
print(f"Head bone tail: {head_tail}")

# Check mesh world transform
print(f"Mesh world matrix: {mesh_obj.matrix_world}")
print(f"Mesh location: {mesh_obj.location}")

# Get vertex stats in LOCAL space
mesh = mesh_obj.data
local_z = [v.co.z for v in mesh.vertices]
local_x = [v.co.x for v in mesh.vertices]
local_y = [v.co.y for v in mesh.vertices]
print(f"\nLocal vertex bounds:")
print(f"  X: {min(local_x):.4f} to {max(local_x):.4f}")
print(f"  Y: {min(local_y):.4f} to {max(local_y):.4f}")
print(f"  Z: {min(local_z):.4f} to {max(local_z):.4f}")

# Get vertex stats in WORLD space
world_positions = [mesh_obj.matrix_world @ v.co for v in mesh.vertices]
world_z = [p.z for p in world_positions]
world_x = [p.x for p in world_positions]
world_y = [p.y for p in world_positions]
print(f"\nWorld vertex bounds:")
print(f"  X: {min(world_x):.4f} to {max(world_x):.4f}")
print(f"  Y: {min(world_y):.4f} to {max(world_y):.4f}")
print(f"  Z: {min(world_z):.4f} to {max(world_z):.4f}")

# Count vertices at various distances from head
for radius in [0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0]:
    count = sum(1 for p in world_positions if (p - head_world).length < radius)
    print(f"  Vertices within {radius}m of head: {count}")

# Show vertices closest to head
dists = [(i, (world_positions[i] - head_world).length, world_positions[i]) for i in range(len(world_positions))]
dists.sort(key=lambda x: x[1])
print(f"\n10 closest vertices to head bone:")
for i, d, p in dists[:10]:
    print(f"  v{i}: dist={d:.4f}, pos=({p.x:.4f}, {p.y:.4f}, {p.z:.4f})")

# Check what's in the top 15% of model
top_z = max(world_z) - (max(world_z) - min(world_z)) * 0.15
top_verts = [(i, p) for i, p in enumerate(world_positions) if p.z >= top_z]
print(f"\nVertices in top 15% (z >= {top_z:.4f}): {len(top_verts)}")

# Front face detection - which axis is "forward"?
if top_verts:
    top_y = [p.y for _, p in top_verts]
    print(f"  Top verts Y range: {min(top_y):.4f} to {max(top_y):.4f}")
    # Front half
    y_mid = (min(top_y) + max(top_y)) / 2
    front = [(i, p) for i, p in top_verts if p.y < y_mid]
    back = [(i, p) for i, p in top_verts if p.y >= y_mid]
    print(f"  Front (y < {y_mid:.4f}): {len(front)} verts")
    print(f"  Back (y >= {y_mid:.4f}): {len(back)} verts")
