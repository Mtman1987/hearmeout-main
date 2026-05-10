"""Inspect FBX for shape keys and mesh details."""
import bpy
import os

FBX_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Meshy_AI_Character_output.fbx")

# Clear and import
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=FBX_PATH)

print("\n" + "=" * 60)
print("MODEL INSPECTION")
print("=" * 60)

for obj in bpy.context.scene.objects:
    print(f"\nObject: {obj.name} | Type: {obj.type}")
    if obj.type == 'MESH':
        mesh = obj.data
        print(f"  Vertices: {len(mesh.vertices)}")
        print(f"  Faces: {len(mesh.polygons)}")
        print(f"  Materials: {[m.name for m in mesh.materials if m]}")
        if mesh.shape_keys:
            print(f"  Shape Keys: {[kb.name for kb in mesh.shape_keys.key_blocks]}")
        else:
            print("  Shape Keys: NONE")
        # Check vertex groups
        if obj.vertex_groups:
            print(f"  Vertex Groups ({len(obj.vertex_groups)}): {[vg.name for vg in obj.vertex_groups[:10]]}...")
    elif obj.type == 'ARMATURE':
        bones = obj.data.bones
        print(f"  Bones ({len(bones)}): {[b.name for b in bones]}")

print("\n" + "=" * 60)
