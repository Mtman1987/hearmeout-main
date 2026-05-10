"""
Generate facial blend shapes for VRM and re-export.
Creates VRM-compatible shape keys for VSeeFace face tracking.

Run with: blender --background --python generate_face_blendshapes.py
"""

import bpy
import os
import sys
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FBX_PATH = os.path.join(SCRIPT_DIR, "Meshy_AI_Character_output.fbx")
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "Meshy_AI_Character_output.vrm")


def main():
    print("=" * 60)
    print("[BlendShapes] Generating Face Blend Shapes for VRM")
    print("=" * 60)

    # Enable VRM addon v3.26.8 (supports VRM 0.x export)
    try:
        bpy.ops.preferences.addon_enable(module="VRM_Addon_for_Blender-release")
        print("[BlendShapes] VRM addon v3 enabled")
    except Exception as e:
        print(f"[BlendShapes] VRM addon failed: {e}")
        sys.exit(1)

    # Clear and import
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.fbx(filepath=FBX_PATH)
    print("[BlendShapes] FBX imported")

    # Find objects (pick largest mesh)
    mesh_obj = None
    armature = None
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            if mesh_obj is None or len(obj.data.vertices) > len(mesh_obj.data.vertices):
                mesh_obj = obj
        elif obj.type == 'ARMATURE' and armature is None:
            armature = obj

    if not mesh_obj or not armature:
        print("[BlendShapes] Missing mesh or armature")
        sys.exit(1)

    # Apply transforms to make world = local
    bpy.context.view_layer.objects.active = mesh_obj
    mesh_obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mesh_obj.select_set(False)

    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    armature.select_set(False)

    print("[BlendShapes] Transforms applied")

    # Now local = world, get head position
    head_bone = armature.data.bones.get("Head")
    if not head_bone:
        print("[BlendShapes] No Head bone found")
        sys.exit(1)

    head_center = head_bone.head_local
    print(f"[BlendShapes] Head center: {head_center}")

    # Get mesh data
    mesh = mesh_obj.data
    verts = mesh.vertices
    print(f"[BlendShapes] Mesh: {mesh_obj.name}, {len(verts)} vertices")

    # Compute world positions (now local = world after apply)
    positions = [v.co.copy() for v in verts]

    # Find head vertices (within 15cm)
    head_vert_indices = []
    for i, pos in enumerate(positions):
        if (pos - head_center).length < 0.15:
            head_vert_indices.append(i)

    print(f"[BlendShapes] Vertices near head: {len(head_vert_indices)}")

    if len(head_vert_indices) < 10:
        # Try larger radius
        for i, pos in enumerate(positions):
            if (pos - head_center).length < 0.3:
                head_vert_indices.append(i)
        head_vert_indices = list(set(head_vert_indices))
        print(f"[BlendShapes] Expanded search: {len(head_vert_indices)} vertices")

    if len(head_vert_indices) < 10:
        print("[BlendShapes] Not enough head vertices found")
        sys.exit(1)

    # Get bounds of head area
    head_positions = [positions[i] for i in head_vert_indices]
    min_x = min(p.x for p in head_positions)
    max_x = max(p.x for p in head_positions)
    min_y = min(p.y for p in head_positions)
    max_y = max(p.y for p in head_positions)
    min_z = min(p.z for p in head_positions)
    max_z = max(p.z for p in head_positions)

    center_x = (min_x + max_x) / 2
    head_height = max_z - min_z
    head_width = max_x - min_x
    y_mid = (min_y + max_y) / 2

    print(f"[BlendShapes] Head bounds: X[{min_x:.3f},{max_x:.3f}] Y[{min_y:.3f},{max_y:.3f}] Z[{min_z:.3f},{max_z:.3f}]")
    print(f"[BlendShapes] Head height: {head_height:.3f}, width: {head_width:.3f}")

    # Front face = negative Y (confirmed from debug)
    front_indices = [i for i in head_vert_indices if positions[i].y < y_mid]
    print(f"[BlendShapes] Front face vertices: {len(front_indices)}")

    # Define face regions
    eye_z_min = min_z + head_height * 0.50
    eye_z_max = min_z + head_height * 0.72
    mouth_z_min = min_z + head_height * 0.15
    mouth_z_max = min_z + head_height * 0.40
    brow_z_min = min_z + head_height * 0.68
    brow_z_max = min_z + head_height * 0.85

    left_eye = []
    right_eye = []
    mouth = []
    upper_lip = []
    lower_lip = []
    brow = []

    mouth_z_mid = (mouth_z_min + mouth_z_max) / 2

    for i in front_indices:
        p = positions[i]

        # Eyes
        if eye_z_min <= p.z <= eye_z_max:
            if p.x < center_x - head_width * 0.03:
                left_eye.append(i)
            elif p.x > center_x + head_width * 0.03:
                right_eye.append(i)

        # Mouth
        if mouth_z_min <= p.z <= mouth_z_max:
            if abs(p.x - center_x) < head_width * 0.3:
                mouth.append(i)
                if p.z > mouth_z_mid:
                    upper_lip.append(i)
                else:
                    lower_lip.append(i)

        # Brow
        if brow_z_min <= p.z <= brow_z_max:
            brow.append(i)

    print(f"[BlendShapes] Regions: left_eye={len(left_eye)}, right_eye={len(right_eye)}, mouth={len(mouth)}, brow={len(brow)}")

    # --- Generate Shape Keys ---
    # Shape keys work in LOCAL space (which is now = world after apply)
    bpy.context.view_layer.objects.active = mesh_obj
    mesh_obj.select_set(True)

    # Scale factor for deformations
    scale = head_height * 0.06  # 6% of head height
    print(f"[BlendShapes] Deformation scale: {scale:.4f}")

    # Create basis
    if not mesh.shape_keys:
        mesh_obj.shape_key_add(name="Basis", from_mix=False)

    basis = mesh.shape_keys.key_blocks["Basis"]
    created = 0

    # Helper to create shape key
    def make_sk(name, indices, offset_fn):
        nonlocal created
        if not indices:
            return
        sk = mesh_obj.shape_key_add(name=name, from_mix=False)
        sk.value = 0.0
        for idx in indices:
            orig = basis.data[idx].co.copy()
            sk.data[idx].co = orig + offset_fn(orig, idx)
        created += 1
        print(f"  Created: {name} ({len(indices)} verts)")

    # BLINK_L - eyelid vertices move down
    make_sk("Blink_L", left_eye, lambda o, i: Vector((0, 0, -scale * 0.4)))

    # BLINK_R
    make_sk("Blink_R", right_eye, lambda o, i: Vector((0, 0, -scale * 0.4)))

    # A - mouth open wide (lower lip down)
    target = lower_lip if lower_lip else mouth
    make_sk("A", target, lambda o, i: Vector((0, 0, -scale * 0.8)))

    # I - mouth wide (stretch horizontally)
    if mouth:
        mouth_cx = sum(positions[i].x for i in mouth) / len(mouth)
        make_sk("I", mouth, lambda o, i: Vector(((o.x - mouth_cx) * 0.2, 0, -scale * 0.2)))

    # U - pucker (compress horizontally, push forward)
    if mouth:
        mouth_cx = sum(positions[i].x for i in mouth) / len(mouth)
        make_sk("U", mouth, lambda o, i: Vector((-(o.x - mouth_cx) * 0.25, -scale * 0.3, 0)))

    # E - mid open
    if mouth:
        mouth_cx = sum(positions[i].x for i in mouth) / len(mouth)
        make_sk("E", mouth, lambda o, i: Vector(((o.x - mouth_cx) * 0.12, 0, -scale * 0.3)))

    # O - round (compress X, open Z)
    if mouth:
        mouth_cx = sum(positions[i].x for i in mouth) / len(mouth)
        mouth_cz = sum(positions[i].z for i in mouth) / len(mouth)
        make_sk("O", mouth, lambda o, i: Vector((-(o.x - mouth_cx) * 0.2, -scale * 0.2, (o.z - mouth_cz) * 0.3)))

    # Joy - smile (corners up and out)
    if mouth:
        mouth_cx = sum(positions[i].x for i in mouth) / len(mouth)
        make_sk("Joy", mouth, lambda o, i: Vector(((o.x - mouth_cx) * 0.15, 0, abs(o.x - mouth_cx) * 0.4)))

    # Angry - brows down and in
    if brow:
        brow_cx = sum(positions[i].x for i in brow) / len(brow)
        make_sk("Angry", brow, lambda o, i: Vector((-(o.x - brow_cx) * 0.1, 0, -scale * 0.3)))

    # Sorrow - inner brows up
    if brow:
        brow_cx = sum(positions[i].x for i in brow) / len(brow)
        make_sk("Sorrow", brow, lambda o, i: Vector((0, 0, scale * 0.3 * max(0, 1.0 - abs(o.x - brow_cx) * 8))))

    # Surprised - brows up + mouth open
    surprise_verts = list(set(brow + mouth))
    if surprise_verts:
        brow_set = set(brow)
        make_sk("Surprised", surprise_verts,
                lambda o, i: Vector((0, 0, scale * 0.4)) if i in brow_set else Vector((0, 0, -scale * 0.6)))

    # LookUp/Down/Left/Right - eye gaze
    all_eyes = list(set(left_eye + right_eye))
    make_sk("LookUp", all_eyes, lambda o, i: Vector((0, 0, scale * 0.2)))
    make_sk("LookDown", all_eyes, lambda o, i: Vector((0, 0, -scale * 0.2)))
    make_sk("LookLeft", all_eyes, lambda o, i: Vector((-scale * 0.2, 0, 0)))
    make_sk("LookRight", all_eyes, lambda o, i: Vector((scale * 0.2, 0, 0)))

    print(f"\n[BlendShapes] Total shape keys created: {created}")

    if created == 0:
        print("[BlendShapes] No blend shapes created!")
        sys.exit(1)

    # --- Setup VRM ---
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)

    vrm_data = armature.data.vrm_addon_extension

    # Metadata
    vrm_data.vrm0.meta.title = "Meshy AI Character"
    vrm_data.vrm0.meta.author = "StreamWeaver"
    vrm_data.vrm0.meta.allowed_user_name = "Everyone"
    vrm_data.vrm0.meta.violent_ussage_name = "Disallow"
    vrm_data.vrm0.meta.sexual_ussage_name = "Disallow"
    vrm_data.vrm0.meta.commercial_ussage_name = "Allow"
    vrm_data.vrm0.meta.license_name = "Other"

    # Humanoid bones
    BONE_MAP = {
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

    humanoid = vrm_data.vrm0.humanoid
    for human_bone in humanoid.human_bones:
        if human_bone.bone in BONE_MAP:
            human_bone.node.bone_name = BONE_MAP[human_bone.bone]

    print("[BlendShapes] VRM humanoid configured")

    # Blend shape proxies
    VRM_PRESETS = {
        "blink_l": "Blink_L", "blink_r": "Blink_R",
        "a": "A", "i": "I", "u": "U", "e": "E", "o": "O",
        "joy": "Joy", "angry": "Angry", "sorrow": "Sorrow", "fun": "Surprised",
        "lookup": "LookUp", "lookdown": "LookDown",
        "lookleft": "LookLeft", "lookright": "LookRight",
    }

    blend_shape_master = vrm_data.vrm0.blend_shape_master
    blend_shape_master.blend_shape_groups.clear()

    shape_keys = mesh_obj.data.shape_keys
    for preset, sk_name in VRM_PRESETS.items():
        if sk_name not in shape_keys.key_blocks:
            continue
        group = blend_shape_master.blend_shape_groups.add()
        group.name = sk_name
        group.preset_name = preset
        bind = group.binds.add()
        bind.mesh.mesh_object_name = mesh_obj.name
        bind.index = sk_name
        bind.weight = 1.0

    print("[BlendShapes] VRM blend shape proxies configured")

    # Force VRM 0.x export
    vrm_data.spec_version = "0.0"
    print("[BlendShapes] spec_version set to 0.0 (VRM 0.x)")

    # Export VRM 0.x
    print(f"[BlendShapes] Exporting VRM 0.x: {OUTPUT_PATH}")
    try:
        bpy.ops.export_scene.vrm(filepath=OUTPUT_PATH)
        print(f"[BlendShapes] VRM 0.x exported!")
    except Exception as e:
        print(f"[BlendShapes] Export failed: {e}")
        sys.exit(1)

    print("=" * 60)
    print(f"[BlendShapes] DONE! {created} blend shapes added to VRM")
    print(f"[BlendShapes] Output: {OUTPUT_PATH}")
    print("=" * 60)


if __name__ == "__main__":
    main()
