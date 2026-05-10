import bpy
from mathutils import Vector
import os

FBX_PATH = r"c:\Users\mtman\Desktop\finished\hearmeout-main\Meshy_AI_Character_output.fbx"
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
bpy.ops.import_scene.fbx(filepath=FBX_PATH)

mesh_obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
armature = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE'][0]

head_center = armature.matrix_world @ armature.data.bones["Head"].head_local
wm = mesh_obj.matrix_world

print(f"HEAD CENTER: {head_center}")
print(f"MESH MATRIX:\n{wm}")
print(f"MESH SCALE: {mesh_obj.scale}")

# Test a few vertices
for i in [0, 100, 500, 1000, 5000, 10000, 25000, 50000]:
    if i < len(mesh_obj.data.vertices):
        local = mesh_obj.data.vertices[i].co
        world = wm @ local
        dist = (world - head_center).length
        print(f"  v{i}: local=({local.x:.2f},{local.y:.2f},{local.z:.2f}) world=({world.x:.4f},{world.y:.4f},{world.z:.4f}) dist_to_head={dist:.4f}")

# Count near head
count = 0
for v in mesh_obj.data.vertices:
    world = wm @ v.co
    if (world - head_center).length < 0.15:
        count += 1
print(f"\nVERTICES WITHIN 0.15m OF HEAD: {count}")

# Also check: are there TWO mesh objects?
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print(f"\nMESH OBJECTS: {[(m.name, len(m.data.vertices)) for m in meshes]}")
