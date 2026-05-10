import bpy
import sys
import os

bpy.ops.preferences.addon_enable(module="VRM_Addon_for_Blender-release")

# Check export operator properties
try:
    op_class = bpy.types.EXPORT_SCENE_OT_vrm
    print("VRM Export operator properties:")
    for prop in op_class.bl_rna.properties:
        if prop.identifier == 'rna_type':
            continue
        desc = getattr(prop, 'description', '')
        ptype = prop.type
        if hasattr(prop, 'enum_items'):
            items = [item.identifier for item in prop.enum_items]
            print(f"  {prop.identifier}: {ptype} = {items} -- {desc}")
        else:
            print(f"  {prop.identifier}: {ptype} -- {desc}")
except Exception as e:
    print(f"Error: {e}")

# Check if there's a vrm0-specific export
print("\nAll VRM-related operators:")
for cat in ['export_scene', 'vrm']:
    if hasattr(bpy.ops, cat):
        ops = dir(getattr(bpy.ops, cat))
        for op in ops:
            if 'vrm' in op.lower() or 'export' in op.lower():
                print(f"  bpy.ops.{cat}.{op}")
