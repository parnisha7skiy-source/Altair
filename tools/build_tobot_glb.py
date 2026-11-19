#!/usr/bin/env python3
"""
Генератор временной 3D-модели Тобота (placeholder-rig) -> tobot.glb

Blender не нужен: скрипт строит геометрию из примитивов (эллипсоиды, цилиндры),
собирает иерархию "костей" (узлов glTF), 9 анимационных клипов и пишет GLB.

КОНТРАКТ для замены на финальную модель (см. README):
  - клипы с именами: Idle, Greeting, Talking, Listening, Happy, Thinking, Sad, Victory, Pointing
  - необязательные узлы: Mouth, EyeL, EyeR, BrowL, BrowR, Antenna, Head  (рантайм подстраивается)
Запуск: python3 build_tobot_glb.py [out.glb]
"""
import json, math, struct, sys
import numpy as np

# ----------------------------------------------------------------- геометрия
# ВАЖНО: все треугольники ориентированы НАРУЖУ (против часовой при взгляде снаружи).
# В v1 порядок был обратным -> в браузере рисовалась изнанка, модель «просвечивалась».
# Скрипт проверяет ориентацию каждого меша (знаковый объём > 0) и падает при ошибке.
def rot_matrix(rx=0, ry=0, rz=0):
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx

def grid_index(n, seg):
    idx = []
    for i in range(n - 1):
        for k in range(seg):
            a = i * (seg + 1) + k; b = a + 1; c = a + seg + 1; d = c + 1
            idx += [a, c, b, b, c, d]          # наружу
    return idx

def finish(P, N, idx, rot=None, offset=(0, 0, 0)):
    if rot is not None:
        R = rot_matrix(*rot); P = P @ R.T; N = N @ R.T
    P = P + np.array(offset, float)
    N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    idx = np.array(idx, np.uint32)
    tri = P[idx.reshape(-1, 3)]
    vol = np.einsum('ij,ij->i', tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6
    assert vol > 0, 'меш вывернут наизнанку'
    return P.astype(np.float32), N.astype(np.float32), idx.astype(np.uint16)

def lathe(profile, seg=20, rot=None, offset=(0, 0, 0)):
    """Тело вращения вокруг Y. profile: [(r, y)] снизу вверх."""
    P, N = [], []
    n = len(profile)
    for i, (r, y) in enumerate(profile):
        a = profile[max(i - 1, 0)]; b = profile[min(i + 1, n - 1)]
        nr, ny = (b[1] - a[1]), -(b[0] - a[0])
        l = math.hypot(nr, ny) or 1.0; nr, ny = nr / l, ny / l
        for k in range(seg + 1):
            th = 2 * math.pi * k / seg; c, s = math.cos(th), math.sin(th)
            P.append((r * c, y, r * s)); N.append((nr * c, ny, nr * s))
    return finish(np.array(P, float), np.array(N, float), grid_index(n, seg), rot, offset)

def rbox(rx, ry, rz, e=0.35, seg=24, rings=16, rot=None, offset=(0, 0, 0)):
    """Скруглённый «бокс» (суперэллипсоид). e=1 — эллипсоид, e->0 — куб. Нормали аналитические."""
    sp = lambda v, p: np.sign(v) * np.abs(v) ** p
    P, N = [], []
    q = 2.0 / e
    for i in range(rings + 1):
        v = -math.pi / 2 + math.pi * i / rings
        for k in range(seg + 1):
            u = 2 * math.pi * k / seg
            cv, sv, cu, su = math.cos(v), math.sin(v), math.cos(u), math.sin(u)
            x = rx * sp(cv, e) * sp(cu, e); y = ry * sp(sv, e); z = rz * sp(cv, e) * sp(su, e)
            P.append((x, y, z))
            g = [np.sign(c) * abs(c / r) ** (q - 1) / r if abs(c) > 1e-9 else 0.0 for c, r in ((x, rx), (y, ry), (z, rz))]
            if not any(g): g = [0, 1 if y > 0 else -1, 0]
            N.append(g)
    return finish(np.array(P, float), np.array(N, float), grid_index(rings + 1, seg), rot, offset)

def ellipsoid(rx, ry, rz, seg=20, rings=12, **kw):
    return rbox(rx, ry, rz, 1.0, seg, rings, **kw)

def cylinder(r, h, seg=18, **kw):
    e = min(r * 0.3, h * 0.25)
    prof = [(0.0, -h / 2), (r - e, -h / 2), (r, -h / 2 + e), (r, h / 2 - e), (r - e, h / 2), (0.0, h / 2)]
    return lathe(prof, seg, **kw)

def tire(r, w, seg=24, **kw):
    """Колесо: ось вдоль X. Скруглённая шина."""
    prof = [(0.0, -w / 2), (r * 0.55, -w / 2), (r * 0.9, -w / 2 + w * 0.05), (r, -w * 0.25), (r, w * 0.25),
            (r * 0.9, w / 2 - w * 0.05), (r * 0.55, w / 2), (0.0, w / 2)]
    return lathe(prof, seg, rot=(0, 0, math.pi / 2), **kw)

# --------------------------------------------------------------- материалы
def mat(name, rgb, rough=0.45, metal=0.0, emis=None):
    m = {"name": name, "pbrMetallicRoughness": {"baseColorFactor": [*rgb, 1.0], "metallicFactor": metal, "roughnessFactor": rough}}
    if emis: m["emissiveFactor"] = list(emis)
    return m

# Оригинальная палитра: мятно-зелёный + белый + тёмно-синий + жёлтый + оранжевый гребень
MATS = [
    mat("White",   (0.95, 0.96, 0.98), 0.30, 0.05),
    mat("Green",   (0.10, 0.78, 0.48), 0.32, 0.15),
    mat("Navy",    (0.10, 0.16, 0.32), 0.45, 0.30),
    mat("Visor",   (0.03, 0.05, 0.12), 0.12, 0.40),
    mat("EyeGlow", (0.30, 0.95, 1.00), 0.30, 0.0, (0.35, 0.95, 1.0)),
    mat("Yellow",  (1.00, 0.82, 0.12), 0.35, 0.0, (0.30, 0.22, 0.0)),
    mat("Orange",  (1.00, 0.48, 0.10), 0.35, 0.05),
    mat("Tire",    (0.10, 0.10, 0.12), 0.80, 0.0),
    mat("Metal",   (0.62, 0.66, 0.74), 0.35, 0.70),
    mat("Mouth",   (1.00, 0.55, 0.45), 0.3, 0.0, (1.0, 0.45, 0.35)),
    mat("Grille",  (0.18, 0.20, 0.26), 0.50, 0.60),
]
M = {m["name"]: i for i, m in enumerate(MATS)}

# ------------------------------------------------------------------- узлы
class Node:
    def __init__(s, name, parent, t=(0, 0, 0), mesh=None, mat=None):
        s.name, s.t, s.mesh, s.mat, s.children, s.parent = name, t, mesh, mat, [], parent
        s.index = None
        if parent: parent.children.append(s)

NODES = []
def add(name, parent, t=(0, 0, 0), mesh=None, mat=None):
    n = Node(name, parent, t, mesh, mat); NODES.append(n); return n

def build_character():
    """Оригинальный робот-машинка «в стиле трансформеров-игрушек». Имена костей — контракт анимаций."""
    NODES.clear()
    root = add("Root", None)
    hips = add("Hips", root, (0, 0.46, 0))
    add("Pelvis_mesh", hips, (0, 0, 0), rbox(0.19, 0.08, 0.14, 0.45, 20, 10), M["Navy"])
    add("Buckle", hips, (0, 0.01, 0.135), rbox(0.06, 0.045, 0.02, 0.35, 12, 8), M["Yellow"])
    torso = add("Torso", hips, (0, 0.10, 0))
    add("Torso_mesh", torso, (0, 0.20, 0), rbox(0.27, 0.24, 0.18, 0.4, 28, 18), M["Green"])
    add("Waist", torso, (0, 0.0, 0), cylinder(0.17, 0.08, 22), M["Metal"])
    # грудь = капот машины: белая панель, решётка радиатора, фары, эмблема
    add("Hood", torso, (0, 0.31, 0.135), rbox(0.23, 0.10, 0.07, 0.3, 24, 12), M["White"])
    add("Grille", torso, (0, 0.165, 0.165), rbox(0.15, 0.05, 0.03, 0.25, 20, 10), M["Grille"])
    for k in range(-2, 3):
        add(f"GrilleBar{k+2}", torso, (k * 0.055, 0.165, 0.19), rbox(0.012, 0.04, 0.012, 0.5, 8, 6), M["Metal"])
    for sx in (1, -1):
        add("Headlight" + ("L" if sx > 0 else "R"), torso, (sx * 0.205, 0.165, 0.155), rbox(0.045, 0.03, 0.03, 0.5, 14, 8), M["Yellow"])
    add("Emblem", torso, (0, 0.32, 0.205), rbox(0.05, 0.05, 0.02, 0.6, 16, 8), M["Orange"])
    # колёса на спине (как у машинки)
    for sx in (1, -1):
        add("BackWheel" + ("L" if sx > 0 else "R"), torso, (sx * 0.17, 0.20, -0.20), tire(0.10, 0.07, 22), M["Tire"])
    neck = add("Neck", torso, (0, 0.42, 0))
    add("Neck_mesh", neck, (0, 0.03, 0), cylinder(0.06, 0.09, 14), M["Metal"])
    head = add("Head", neck, (0, 0.08, 0))
    add("Helmet", head, (0, 0.22, -0.01), rbox(0.25, 0.23, 0.23, 0.55, 28, 18), M["White"])
    add("HelmetTop", head, (0, 0.34, -0.03), rbox(0.24, 0.10, 0.21, 0.5, 24, 12), M["Green"])
    add("Crest", head, (0, 0.44, -0.02), rbox(0.03, 0.06, 0.17, 0.45, 14, 10), M["Orange"])
    add("Visor", head, (0, 0.20, 0.19), rbox(0.20, 0.135, 0.07, 0.4, 26, 14), M["Visor"])
    add("Chin", head, (0, 0.04, 0.12), rbox(0.12, 0.04, 0.09, 0.5, 16, 8), M["White"])
    for side, sx in (("L", 1), ("R", -1)):
        eye = add("Eye" + side, head, (sx * 0.085, 0.225, 0.258), ellipsoid(0.058, 0.068, 0.02, 18, 10), M["EyeGlow"])
        add("EyeShine" + side, eye, (0.02, 0.028, 0.016), ellipsoid(0.018, 0.018, 0.008, 10, 6), M["White"])
        add("Brow" + side, head, (sx * 0.085, 0.315, 0.252), rbox(0.05, 0.011, 0.01, 0.5, 12, 6), M["EyeGlow"])
        ear = add("Ear" + side, head, (sx * 0.255, 0.21, -0.01), tire(0.075, 0.05, 20), M["Navy"])
        add("EarCap" + side, ear, (sx * 0.028, 0, 0), cylinder(0.045, 0.015, 16, rot=(0, 0, math.pi / 2)), M["Yellow"])
    add("Mouth", head, (0, 0.115, 0.255), ellipsoid(0.045, 0.025, 0.012, 14, 8), M["Mouth"])
    ant = add("Antenna", head, (0.15, 0.42, -0.06))
    add("Antenna_stick", ant, (0, 0.05, 0), cylinder(0.011, 0.10, 8), M["Metal"])
    add("Antenna_ball", ant, (0, 0.11, 0), ellipsoid(0.032, 0.032, 0.032, 12, 8), M["Yellow"])
    # руки: плечо-крыло с колесом, массивное предплечье, кулак
    for side, sx in (("L", 1), ("R", -1)):
        sh = add("Shoulder" + side, torso, (sx * 0.33, 0.33, 0), rbox(0.10, 0.09, 0.12, 0.4, 18, 10), M["Green"])
        add("ShoulderWheel" + side, sh, (sx * 0.09, -0.01, 0), tire(0.075, 0.05, 20), M["Tire"])
        add("ShoulderHub" + side, sh, (sx * 0.118, -0.01, 0), cylinder(0.04, 0.012, 14, rot=(0, 0, math.pi / 2)), M["Yellow"])
        ua = add("UpperArm" + side, sh, (0, 0, 0), cylinder(0.048, 0.17, 14, offset=(0, -0.11, 0)), M["Navy"])
        el = add("Elbow" + side, ua, (0, -0.19, 0), ellipsoid(0.055, 0.055, 0.055, 12, 8), M["Metal"])
        fa = add("ForeArm" + side, el, (0, 0, 0), rbox(0.065, 0.09, 0.07, 0.4, 16, 10, offset=(0, -0.08, 0)), M["White"])
        add("Cuff" + side, fa, (0, -0.15, 0), cylinder(0.068, 0.03, 16), M["Green"])
        hand = add("Hand" + side, fa, (0, -0.20, 0), rbox(0.065, 0.06, 0.06, 0.5, 14, 10), M["White"])
        add("Finger" + side, hand, (0, -0.06, 0.03), cylinder(0.018, 0.07, 8), M["White"])
        add("Thumb" + side, hand, (-sx * 0.05, -0.01, 0.04), ellipsoid(0.022, 0.03, 0.022, 10, 6), M["White"])
    # ноги: белое бедро, зелёная голень-крыло с колесом, ботинок
    for side, sx in (("L", 1), ("R", -1)):
        hp = add("Hip" + side, hips, (sx * 0.12, -0.04, 0))
        add("Thigh_mesh" + side, hp, (0, -0.08, 0), rbox(0.065, 0.08, 0.07, 0.5, 14, 10), M["Navy"])
        kn = add("Knee" + side, hp, (0, -0.16, 0), ellipsoid(0.058, 0.058, 0.058, 12, 8), M["Metal"])
        add("Shin_mesh" + side, kn, (0, -0.09, 0.0), rbox(0.08, 0.10, 0.085, 0.4, 16, 10), M["Green"])
        add("KneePad" + side, kn, (0, -0.02, 0.075), rbox(0.055, 0.05, 0.025, 0.4, 12, 8), M["White"])
        add("LegWheel" + side, kn, (sx * 0.08, -0.10, -0.02), tire(0.06, 0.045, 18), M["Tire"])
        an = add("Ankle" + side, kn, (0, -0.19, 0))
        add("Foot_mesh" + side, an, (0, -0.02, 0.03), rbox(0.08, 0.05, 0.13, 0.4, 16, 10), M["White"])
        add("Toe" + side, an, (0, -0.035, 0.14), rbox(0.075, 0.035, 0.03, 0.4, 12, 8), M["Orange"])
    return root

# -------------------------------------------------------------- анимация
def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return (aw*bx + ax*bw + ay*bz - az*by, aw*by - ax*bz + ay*bw + az*bx,
            aw*bz + ax*by - ay*bx + az*bw, aw*bw - ax*bx - ay*by - az*bz)

def qaxis(axis, ang):
    s = math.sin(ang / 2); c = math.cos(ang / 2)
    return tuple(s * v for v in axis) + (c,)

def euler_q(e):
    x, y, z = e
    # R = Rz * Ry * Rx
    return qmul(qmul(qaxis((0, 0, 1), z), qaxis((0, 1, 0), y)), qaxis((1, 0, 0), x))

FPS = 24
S = math.sin; C = math.cos; PI = math.pi
def env(t, T, a=0.25, b=0.25):
    """Плавная огибающая 0..1..0 для разовых клипов: входим и выходим в позу покоя."""
    u = t / T
    if u < a: return 0.5 - 0.5 * C(PI * u / a)
    if u > 1 - b: return 0.5 - 0.5 * C(PI * (1 - u) / b)
    return 1.0

def arm(side, fwd=0.0, out=0.0, elbow=0.0, twist=0.0):
    """fwd>0 вперёд, out>0 в сторону (от тела), elbow>0 сгибает предплечье вперёд."""
    sgn = 1 if side == "L" else -1
    base_out = 0.13
    return {
        "Shoulder" + side: ("r", (-fwd, twist * sgn, sgn * (base_out + out))),
        "Elbow" + side: ("r", (-elbow - 0.12, 0, 0)),
    }

def merge(*ds):
    o = {}
    for d in ds: o.update(d)
    return o

# Каждая функция возвращает: {узел: ("r", euler) | ("t", offset_xyz) | ("s", scale_xyz)}
def idle(t, T):
    w = 2 * PI * t / T
    b = S(w)
    return merge(
        {"Hips": ("t", (0, 0.008 * b, 0)), "Torso": ("r", (0.015 * b, 0.03 * S(w), 0)),
         "Head": ("r", (0.03 * S(w + 1), 0.08 * S(w), 0.02 * S(w + 2))),
         "Antenna": ("r", (0.08 * S(2 * w), 0, 0.12 * S(2 * w + 1)))},
        arm("L", 0.05 * b, 0.02 * b, 0.05), arm("R", 0.05 * b, 0.02 * b, 0.05))

def greeting(t, T):
    e = env(t, T, 0.2, 0.25); w = 2 * PI * 3 * t / T
    wave = S(w) * min(1, e * 1.5)
    return merge(
        {"Head": ("r", (-0.05 * e, -0.15 * e, -0.10 * e)), "Torso": ("r", (0, -0.10 * e, 0)),
         "Hips": ("t", (0, 0.02 * e * (0.5 + 0.5 * S(w)), 0)),
         "Antenna": ("r", (0.0, 0, 0.25 * S(w) * e)),
         "BrowL": ("t", (0, 0.015 * e, 0)), "BrowR": ("t", (0, 0.015 * e, 0))},
        arm("L", 0.05, 0.02, 0.05),
        arm("R", 0.1 * e, 2.2 * e + 0.0, (0.5 + 0.35 * wave) * e - 0.0))

def talking(t, T):
    w = 2 * PI * t / T
    return merge(
        {"Torso": ("r", (0.02 * S(2 * w), 0.06 * S(w), 0)),
         "Head": ("r", (0.05 * S(2 * w + 0.5), 0.10 * S(w), 0.04 * S(w + 1))),
         "Hips": ("t", (0, 0.006 * S(2 * w), 0)),
         "Antenna": ("r", (0.07 * S(3 * w), 0, 0.1 * S(2 * w)))},
        arm("L", 0.35 + 0.25 * S(w + 0.5), 0.25 + 0.1 * S(2 * w), 0.7 + 0.25 * S(w)),
        arm("R", 0.35 + 0.25 * S(w + 3.1), 0.25 + 0.1 * S(2 * w + 1), 0.7 + 0.25 * S(w + 3)))

def listening(t, T):
    w = 2 * PI * t / T
    return merge(
        {"Torso": ("r", (0.10, 0, 0)), "Head": ("r", (0.04 + 0.02 * S(w), 0.05 * S(w * 0.5), 0.22)),
         "Antenna": ("r", (0.0, 0, 0.2 * S(2 * w))),
         "EyeL": ("s", (1.12, 1.12, 1)), "EyeR": ("s", (1.12, 1.12, 1)),
         "BrowL": ("t", (0, 0.02, 0)), "BrowR": ("t", (0, 0.02, 0)),
         "Hips": ("t", (0, 0.005 * S(w), 0))},
        arm("L", 0.1, 0.05, 0.2), arm("R", 0.5, 0.35, 1.9))  # правая рука к «уху»

def happy(t, T):
    e = env(t, T, 0.12, 0.25); w = 2 * PI * 4 * t / T
    hop = abs(S(w)) * e
    return merge(
        {"Root": ("t", (0, 0.12 * hop, 0)), "Hips": ("t", (0, -0.03 * (1 - hop) * e, 0)),
         "Torso": ("r", (-0.05 * e, 0.12 * S(w / 2) * e, 0)), "Head": ("r", (-0.12 * e, 0.1 * S(w / 2) * e, 0.08 * S(w) * e)),
         "Antenna": ("r", (0, 0, 0.3 * S(w * 2) * e)),
         "EyeL": ("s", (1 + 0.1 * e, 1 - 0.45 * e, 1)), "EyeR": ("s", (1 + 0.1 * e, 1 - 0.45 * e, 1)),  # ^ ^ улыбка глаз
         "HipL": ("r", (-0.35 * hop, 0, 0)), "HipR": ("r", (-0.35 * hop, 0, 0)),
         "KneeL": ("r", (0.6 * hop, 0, 0)), "KneeR": ("r", (0.6 * hop, 0, 0))},
        arm("L", 0.2 * e, 2.0 * e + 0.2 * S(w) * e, 0.3 * e),
        arm("R", 0.2 * e, 2.0 * e + 0.2 * S(w + PI) * e, 0.3 * e))

def thinking(t, T):
    w = 2 * PI * t / T
    e = env(t, T, 0.2, 0.2) if T < 3 else 1.0
    return merge(
        {"Torso": ("r", (0.03 * e, -0.10 * e, 0)), "Head": ("r", (-0.18 * e, 0.28 * e, 0.16 * e + 0.03 * S(w) * e)),
         "Antenna": ("r", (0, 0, 0.18 * S(2 * w) * e)),
         "BrowL": ("t", (0, 0.025 * e, 0)), "BrowR": ("t", (0, -0.005 * e, 0)),
         "EyeL": ("s", (1, 0.85, 1)), "EyeR": ("s", (1, 0.85, 1))},
        arm("L", 0.1, 0.05, 0.1),
        arm("R", 0.85 * e, 0.0, 2.3 * e + 0.05 * S(w) * e, twist=0))  # рука к подбородку

def sad(t, T):
    e = env(t, T, 0.3, 0.3); w = 2 * PI * 2 * t / T
    return merge(
        {"Hips": ("t", (0, -0.03 * e, 0)), "Torso": ("r", (0.16 * e, 0, 0)),
         "Head": ("r", (0.28 * e, 0.12 * S(w) * e, 0.10 * S(w / 2) * e)),
         "Antenna": ("r", (0.5 * e, 0, 0.0)),
         "BrowL": ("r", (0, 0, 0.45 * e)), "BrowR": ("r", (0, 0, -0.45 * e)),   # домиком: мягкое удивление
         "EyeL": ("s", (1, 1 + 0.15 * e, 1)), "EyeR": ("s", (1, 1 + 0.15 * e, 1))},
        arm("L", -0.05 * e, -0.05 * e, 0.1), arm("R", -0.05 * e, -0.05 * e, 0.1))

def victory(t, T):
    e = env(t, T, 0.1, 0.2); w = 2 * PI * 3 * t / T
    jump = max(0.0, S(w)) * e
    return merge(
        {"Root": ("t", (0, 0.20 * jump, 0)), "Hips": ("r", (0, 0, 0)),
         "Torso": ("r", (-0.10 * e, 0.0, 0.05 * S(w) * e)), "Head": ("r", (-0.20 * e, 0.1 * S(w) * e, 0)),
         "Antenna": ("r", (0, 0, 0.35 * S(2 * w) * e)),
         "EyeL": ("s", (1.1, 1 - 0.4 * e, 1)), "EyeR": ("s", (1.1, 1 - 0.4 * e, 1)),
         "HipL": ("r", (-0.5 * jump, 0, 0)), "HipR": ("r", (-0.5 * jump, 0, 0)),
         "KneeL": ("r", (0.9 * jump, 0, 0)), "KneeR": ("r", (0.9 * jump, 0, 0))},
        arm("L", 0.05 * e, 2.7 * e + 0.15 * S(w * 2) * e, 0.15 * e),
        arm("R", 0.05 * e, 2.7 * e + 0.15 * S(w * 2 + 1) * e, 0.15 * e))

def pointing(t, T):
    e = env(t, T, 0.25, 0.25); hold = S(2 * PI * 2 * t / T)
    return merge(
        {"Torso": ("r", (0.08 * e, -0.22 * e, 0)), "Head": ("r", (0.02 * e, -0.28 * e, 0.0)),
         "Antenna": ("r", (0.15 * e * hold, 0, 0)), "Hips": ("t", (0, 0, 0))},
        arm("L", 0.05, 0.02, 0.1),
        arm("R", 1.45 * e, 0.45 * e, 0.12 * e))  # рука вытянута вперёд-вбок

CLIPS = [  # имя, длительность, функция, зациклен ли
    ("Idle", 4.0, idle, True), ("Greeting", 2.4, greeting, False), ("Talking", 2.0, talking, True),
    ("Listening", 3.0, listening, True), ("Happy", 2.0, happy, False), ("Thinking", 3.0, thinking, True),
    ("Sad", 2.2, sad, False), ("Victory", 3.0, victory, False), ("Pointing", 2.4, pointing, False),
]

# Корректирующая «спина» для вращения Root в Victory (оборот вокруг Y) — через отдельный канал
def victory_root_spin(t, T):
    u = t / T
    k = min(1, max(0, (u - 0.2) / 0.5))
    k = 0.5 - 0.5 * C(PI * k)
    return 2 * PI * k

# --------------------------------------------------------------- GLB writer
def build_glb(out):
    root = build_character()
    for i, n in enumerate(NODES): n.index = i
    rest_t = {n.name: n.t for n in NODES}

    blob = bytearray(); views = []; accs = []
    def push(data: bytes, target=None):
        while len(blob) % 4: blob.append(0)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), **({"target": target} if target else {})})
        blob.extend(data); return len(views) - 1
    def acc(view, ctype, count, typ, mn=None, mx=None):
        a = {"bufferView": view, "componentType": ctype, "count": count, "type": typ}
        if mn is not None: a["min"], a["max"] = mn, mx
        accs.append(a); return len(accs) - 1

    meshes = []; mesh_of = {}
    for n in NODES:
        if n.mesh is None: continue
        P, Nn, idx = n.mesh
        pv = push(P.tobytes(), 34962); nv = push(Nn.tobytes(), 34962); iv = push(idx.tobytes(), 34963)
        pa = acc(pv, 5126, len(P), "VEC3", P.min(0).tolist(), P.max(0).tolist())
        na = acc(nv, 5126, len(P), "VEC3"); ia = acc(iv, 5123, len(idx), "SCALAR")
        meshes.append({"name": n.name, "primitives": [{"attributes": {"POSITION": pa, "NORMAL": na}, "indices": ia, "material": n.mat}]})
        mesh_of[n.name] = len(meshes) - 1

    nodes_json = []
    for n in NODES:
        d = {"name": n.name}
        if any(n.t): d["translation"] = [float(v) for v in n.t]
        if n.children: d["children"] = [c.index for c in n.children]
        if n.name in mesh_of: d["mesh"] = mesh_of[n.name]
        nodes_json.append(d)
    by_name = {n.name: n.index for n in NODES}

    # --- клипы
    anims = []
    for name, T, fn, loop in CLIPS:
        steps = int(round(T * FPS))
        times = np.array([i / FPS for i in range(steps + 1)], np.float32)
        # позы для каждого кадра; зацикленные клипы замыкаем (последний кадр == первый)
        frames = []
        for i in range(steps + 1):
            t = times[i] if not (loop and i == steps) else 0.0
            pose = fn(float(t), T)
            if name == "Victory":
                pose["Root"] = ("t", pose["Root"][1])
            frames.append(pose)
        joints = {}
        for f in frames:
            for j, (kind, _) in f.items(): joints.setdefault((j, kind), None)
        # у Victory отдельно вращаем Root вокруг Y
        extra_root_rot = name == "Victory"
        tin = push(times.tobytes()); ain = acc(tin, 5126, len(times), "SCALAR", [float(times.min())], [float(times.max())])
        samplers, channels = [], []
        def add_channel(node, path, arr, typ):
            ov = push(arr.astype(np.float32).tobytes())
            oa = acc(ov, 5126, len(arr), typ)
            samplers.append({"input": ain, "output": oa, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": by_name[node], "path": path}})
        for (j, kind) in joints:
            if j not in by_name: continue
            rows = []
            prev = None
            for f in frames:
                v = f.get(j)
                if v is None or v[0] != kind:
                    v = {"r": ("r", (0, 0, 0)), "t": ("t", (0, 0, 0)), "s": ("s", (1, 1, 1))}[kind]
                val = v[1]
                if kind == "r":
                    q = euler_q(val)
                    if prev is not None and sum(a * b for a, b in zip(q, prev)) < 0: q = tuple(-c for c in q)
                    prev = q; rows.append(q)
                elif kind == "t":
                    base = rest_t[j]; rows.append(tuple(base[k] + val[k] for k in range(3)))
                else:
                    rows.append(tuple(val))
            typ = "VEC4" if kind == "r" else "VEC3"
            add_channel(j, {"r": "rotation", "t": "translation", "s": "scale"}[kind], np.array(rows), typ)
        if extra_root_rot:
            prev = None; rows = []
            for i in range(steps + 1):
                q = qaxis((0, 1, 0), victory_root_spin(float(times[i]), T))
                if prev is not None and sum(a * b for a, b in zip(q, prev)) < 0: q = tuple(-c for c in q)
                prev = q; rows.append(q)
            add_channel("Root", "rotation", np.array(rows), "VEC4")
        anims.append({"name": name, "samplers": samplers, "channels": channels})

    gltf = {
        "asset": {"version": "2.0", "generator": "build_tobot_glb.py v2 (original robot, outward winding)"},
        "scene": 0, "scenes": [{"name": "Tobot", "nodes": [root.index]}],
        "nodes": nodes_json, "meshes": meshes, "materials": MATS, "animations": anims,
        "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(blob)}],
        "extras": {"clips": [c[0] for c in CLIPS], "loopClips": [c[0] for c in CLIPS if c[3]]},
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    while len(js) % 4: js += b" "
    while len(blob) % 4: blob.append(0)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(out, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(blob), 0x004E4942)); f.write(blob)
    tris = sum(len(n.mesh[2]) // 3 for n in NODES if n.mesh)
    print(f"{out}: {total/1024:.1f} KB, nodes={len(NODES)}, meshes={len(meshes)}, tris={tris}, clips={len(anims)}")

if __name__ == "__main__":
    build_glb(sys.argv[1] if len(sys.argv) > 1 else "tobot.glb")
