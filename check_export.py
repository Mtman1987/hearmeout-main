import bpy
bpy.ops.preferences.addon_enable(module="VRM_Addon_for_Blender")

# Check export operator properties
op = bpy.ops.export_scene.vrm
print("VRM Export operator properties:")
print(dir(op))

# Get the operator's RNA properties
import inspect
try:
    # Try to get the operator class
    op_class = bpy.types.EXPORT_SCENE_OT_vrm
    print("\nOperator RNA properties:")
    for prop in op_class.bl_rna.properties:
        if prop.identifier == 'rna_type':
            continue
        print(f"  {prop.identifier}: {prop.type} - {prop.description}")
except:
    pass

# Also check if there's a vrm0 specific export
print("\nAll export_scene operators:")
for attr in dir(bpy.ops.export_scene):
    if 'vrm' in attr.lower():
        print(f"  {attr}")
