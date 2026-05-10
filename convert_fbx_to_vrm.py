"""
FBX to VRM Conversion Script for Blender 5.1
Run with: blender --background --python convert_fbx_to_vrm.py

This script:
1. Installs the VRM addon
2. Imports the FBX file
3. Sets up humanoid bone mapping
4. Exports as VRM 0.x (compatible with VSeeFace)
"""

import bpy
import os
import sys

# Paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FBX_PATH = os.path.join(SCRIPT_DIR, "Meshy_AI_Character_output.fbx")
VRM_ADDON_ZIP = os.path.join(SCRIPT_DIR, "VRM_Addon.zip")
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "Meshy_AI_Character_output.vrm")


def install_vrm_addon():
    """Enable VRM addon (installed to scripts/addons directory)."""
    print("[VRM Convert] Enabling VRM addon...")
    try:
        bpy.ops.preferences.addon_enable(module="VRM_Addon_for_Blender")
        print("[VRM Convert] ✅ VRM addon enabled")
    except Exception as e:
        print(f"[VRM Convert] ⚠️ addon_enable failed: {e}")
        # Try to register manually
        addon_path = os.path.join(
            os.environ.get('APPDATA', ''),
            'Blender Foundation', 'Blender', '5.1', 'scripts', 'addons', 'VRM_Addon_for_Blender'
        )
        if addon_path not in sys.path:
            sys.path.insert(0, addon_path)
        try:
            import importlib
            spec = importlib.util.spec_from_file_location(
                "VRM_Addon_for_Blender",
                os.path.join(addon_path, "__init__.py")
            )
            vrm_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(vrm_module)
            vrm_module.register()
            print("[VRM Convert] ✅ VRM addon registered manually")
        except Exception as e2:
            print(f"[VRM Convert] ❌ Could not load VRM addon: {e2}")
            sys.exit(1)


def clear_scene():
    """Remove all objects from the scene."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


def import_fbx():
    """Import the FBX file."""
    print(f"[VRM Convert] Importing FBX: {FBX_PATH}")
    if not os.path.exists(FBX_PATH):
        print(f"[VRM Convert] ❌ FBX file not found: {FBX_PATH}")
        sys.exit(1)
    bpy.ops.import_scene.fbx(filepath=FBX_PATH)
    print("[VRM Convert] ✅ FBX imported")


def find_armature():
    """Find the armature object in the scene."""
    for obj in bpy.context.scene.objects:
        if obj.type == 'ARMATURE':
            return obj
    return None


# Common bone name mappings from various FBX exports to VRM humanoid bones
BONE_MAP_PATTERNS = {
    "hips": ["hips", "pelvis", "hip", "root"],
    "spine": ["spine", "spine1", "spine_01"],
    "chest": ["chest", "spine2", "spine_02", "upper_spine"],
    "upperChest": ["upperchest", "spine3", "spine_03"],
    "neck": ["neck", "neck_01"],
    "head": ["head"],
    "leftUpperLeg": ["lefthip", "leftupleg", "leftupperleg", "left_upper_leg", "l_upperleg", "thigh_l", "left_thigh"],
    "leftLowerLeg": ["leftknee", "leftleg", "leftlowerleg", "left_lower_leg", "l_lowerleg", "calf_l", "left_calf"],
    "leftFoot": ["leftfoot", "leftankle", "left_foot", "l_foot", "foot_l"],
    "leftToes": ["lefttoebase", "lefttoe", "left_toe", "l_toe", "ball_l"],
    "rightUpperLeg": ["righthip", "rightupleg", "rightupperleg", "right_upper_leg", "r_upperleg", "thigh_r", "right_thigh"],
    "rightLowerLeg": ["rightknee", "rightleg", "rightlowerleg", "right_lower_leg", "r_lowerleg", "calf_r", "right_calf"],
    "rightFoot": ["rightfoot", "rightankle", "right_foot", "r_foot", "foot_r"],
    "rightToes": ["righttoebase", "righttoe", "right_toe", "r_toe", "ball_r"],
    "leftShoulder": ["leftshoulder", "left_shoulder", "l_shoulder", "clavicle_l"],
    "leftUpperArm": ["leftarm", "leftupperarm", "left_upper_arm", "l_upperarm", "upperarm_l"],
    "leftLowerArm": ["leftforearm", "leftlowerarm", "left_lower_arm", "l_lowerarm", "lowerarm_l", "left_elbow"],
    "leftHand": ["lefthand", "left_hand", "l_hand", "hand_l"],
    "rightShoulder": ["rightshoulder", "right_shoulder", "r_shoulder", "clavicle_r"],
    "rightUpperArm": ["rightarm", "rightupperarm", "right_upper_arm", "r_upperarm", "upperarm_r"],
    "rightLowerArm": ["rightforearm", "rightlowerarm", "right_lower_arm", "r_lowerarm", "lowerarm_r", "right_elbow"],
    "rightHand": ["righthand", "right_hand", "r_hand", "hand_r"],
    "leftEye": ["lefteye", "left_eye", "l_eye", "eye_l"],
    "rightEye": ["righteye", "right_eye", "r_eye", "eye_r"],
}


def map_bones(armature):
    """Map armature bones to VRM humanoid bones."""
    print("[VRM Convert] Mapping bones to VRM humanoid...")
    bone_names = [b.name for b in armature.data.bones]
    print(f"[VRM Convert] Found bones: {bone_names}")

    mapped = {}
    for vrm_bone, patterns in BONE_MAP_PATTERNS.items():
        for bone_name in bone_names:
            clean = bone_name.lower().replace(" ", "").replace("_", "").replace("-", "").replace(".", "")
            for pattern in patterns:
                clean_pattern = pattern.lower().replace(" ", "").replace("_", "").replace("-", "")
                if clean == clean_pattern or clean.endswith(clean_pattern):
                    mapped[vrm_bone] = bone_name
                    break
            if vrm_bone in mapped:
                break

    print(f"[VRM Convert] Mapped {len(mapped)} bones:")
    for vrm_name, bone_name in mapped.items():
        print(f"  {vrm_name} -> {bone_name}")

    return mapped


def setup_vrm_humanoid(armature, bone_mapping):
    """Configure VRM humanoid properties on the armature."""
    # Select and make active
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)

    # Access VRM extension data
    vrm_data = armature.data.vrm_addon_extension

    # Set VRM metadata
    vrm_data.vrm0.meta.title = "Meshy AI Character"
    vrm_data.vrm0.meta.author = "StreamWeaver"
    vrm_data.vrm0.meta.allowed_user_name = "Everyone"
    vrm_data.vrm0.meta.violent_ussage_name = "Disallow"
    vrm_data.vrm0.meta.sexual_ussage_name = "Disallow"
    vrm_data.vrm0.meta.commercial_ussage_name = "Allow"
    vrm_data.vrm0.meta.license_name = "Other"

    # Set humanoid bone mapping
    humanoid = vrm_data.vrm0.humanoid
    for human_bone in humanoid.human_bones:
        vrm_name = human_bone.bone
        if vrm_name in bone_mapping:
            human_bone.node.bone_name = bone_mapping[vrm_name]
            print(f"  Set {vrm_name} = {bone_mapping[vrm_name]}")

    print("[VRM Convert] ✅ VRM humanoid configured")


def export_vrm():
    """Export the scene as VRM."""
    print(f"[VRM Convert] Exporting VRM to: {OUTPUT_PATH}")
    try:
        bpy.ops.export_scene.vrm(filepath=OUTPUT_PATH)
        print(f"[VRM Convert] ✅ VRM exported successfully: {OUTPUT_PATH}")
    except Exception as e:
        print(f"[VRM Convert] ❌ VRM export failed: {e}")
        # Try alternative export
        try:
            bpy.ops.export_scene.vrm(filepath=OUTPUT_PATH, export_format='VRM0')
            print(f"[VRM Convert] ✅ VRM exported (VRM0 format): {OUTPUT_PATH}")
        except Exception as e2:
            print(f"[VRM Convert] ❌ Alternative export also failed: {e2}")
            sys.exit(1)


def main():
    print("=" * 60)
    print("[VRM Convert] FBX to VRM Conversion")
    print("=" * 60)

    # Step 1: Install VRM addon
    install_vrm_addon()

    # Step 2: Clear scene and import FBX
    clear_scene()
    import_fbx()

    # Step 3: Find armature
    armature = find_armature()
    if not armature:
        print("[VRM Convert] ❌ No armature found in FBX. Model needs a skeleton for VRM.")
        print("[VRM Convert] Tip: Upload to mixamo.com first to auto-rig, then re-run.")
        sys.exit(1)

    # Step 4: Map bones
    bone_mapping = map_bones(armature)

    # Check minimum required bones
    required = ["hips", "spine", "head", "leftUpperArm", "leftLowerArm", "leftHand",
                "rightUpperArm", "rightLowerArm", "rightHand",
                "leftUpperLeg", "leftLowerLeg", "leftFoot",
                "rightUpperLeg", "rightLowerLeg", "rightFoot"]
    missing = [b for b in required if b not in bone_mapping]
    if missing:
        print(f"[VRM Convert] ⚠️ Missing required bones: {missing}")
        print("[VRM Convert] The model may not work perfectly in VSeeFace.")
        print("[VRM Convert] Continuing anyway...")

    # Step 5: Setup VRM humanoid data
    setup_vrm_humanoid(armature, bone_mapping)

    # Step 6: Export VRM
    export_vrm()

    print("=" * 60)
    print("[VRM Convert] ✅ DONE! Output: " + OUTPUT_PATH)
    print("[VRM Convert] Load this .vrm file in VSeeFace to use it.")
    print("=" * 60)


if __name__ == "__main__":
    main()
