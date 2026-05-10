import bpy
import os
import sys

bpy.ops.preferences.addon_enable(module="VRM_Addon_for_Blender-release")

# Import FBX to get an armature
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=r"c:\Users\mtman\Desktop\finished\hearmeout-main\Meshy_AI_Character_output.fbx")

armature = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE'][0]
bpy.context.view_layer.objects.active = armature

vrm_data = armature.data.vrm_addon_extension

# Check what properties exist on vrm_addon_extension
print("VRM addon extension properties:")
for prop in vrm_data.bl_rna.properties:
    if prop.identifier == 'rna_type':
        continue
    val = getattr(vrm_data, prop.identifier, None)
    print(f"  {prop.identifier}: {prop.type} = {val}")

# Check spec_version specifically
if hasattr(vrm_data, 'spec_version'):
    print(f"\nspec_version = '{vrm_data.spec_version}'")
    # Try to see enum items
    prop = vrm_data.bl_rna.properties.get('spec_version')
    if prop and hasattr(prop, 'enum_items'):
        print(f"  enum items: {[item.identifier for item in prop.enum_items]}")
