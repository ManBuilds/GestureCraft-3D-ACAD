"""Synthetic training data for the gesture classifier.

A 3D hand skeleton with the same 21-point layout as MediaPipe Hands is posed with joint angles
for each gesture, then viewed from a random angle, mirrored (left/right hand), scaled, and
jittered. Output features match collect_data.py / index.html exactly: wrist-centred landmarks
divided by wrist-to-middle-knuckle distance (63 numbers).

Run `python hand_synth.py` to save gesture_samples.png and print the canonical poses.
"""
import json, sys
import numpy as np

LABELS = ["open", "pinch", "peace", "fist", "yo", "other"]

# knuckle position in the palm plane (x right, y toward fingertips; wrist-to-middle-knuckle = 1),
# bone lengths, and resting sideways spread
FINGERS = {
    "index":  dict(mcp=(0.38, 0.95), L=(0.55, 0.32, 0.27), splay=0.09),
    "middle": dict(mcp=(0.00, 1.00), L=(0.60, 0.36, 0.28), splay=0.00),
    "ring":   dict(mcp=(-0.30, 0.93), L=(0.55, 0.33, 0.27), splay=-0.07),
    "pinky":  dict(mcp=(-0.58, 0.82), L=(0.42, 0.24, 0.22), splay=-0.16),
}
THUMB_BASE, THUMB_L = (0.30, 0.18), (0.45, 0.35, 0.30)


class Dice:
    """Random draws, or the typical value when canon=True (used to draw clean reference poses)."""
    def __init__(self, seed=None, canon=False):
        self.r, self.c = np.random.default_rng(seed), canon
    def u(self, a, b): return (a + b) / 2 if self.c else self.r.uniform(a, b)
    def n(self, m, sd): return m if self.c else self.r.normal(m, sd)
    def pick(self, opts, p): return opts[0] if self.c else opts[self.r.choice(len(opts), p=p)]
    def chance(self, p): return False if self.c else self.r.random() < p


def flex(d, state):
    """Three joint bend angles (radians) for an Extended, Curled or Half-bent finger."""
    if state == "E":
        return [np.clip(d.n(.05, .12), -.25, .4), np.clip(d.n(.03, .1), -.2, .35), np.clip(d.n(.03, .1), -.2, .35)]
    if state == "C":
        return [d.u(1.1, 1.6), d.u(1.3, 1.9), d.u(.6, 1.1)]
    return [d.u(.4, .9), d.u(.4, 1.0), d.u(.15, .6)]


def finger_points(name, alphas, splay):
    f = FINGERS[name]
    p = np.array([*f["mcp"], 0.0]); pts = [p.copy()]
    base = np.array([np.sin(splay), np.cos(splay), 0.0]); z = np.array([0, 0, 1.0]); cum = 0.0
    for L, a in zip(f["L"], alphas):
        cum += a
        p = p + L * (np.cos(cum) * base + np.sin(cum) * z)
        pts.append(p.copy())
    return pts


def thumb_chain(abd, fl, cross):
    p = np.array([*THUMB_BASE, 0.0]); pts = [p.copy()]
    for j, L in enumerate(THUMB_L):
        psi, f = abd - cross * j / 2, fl * (0.5 + 0.25 * j)
        p = p + L * np.array([np.sin(psi) * np.cos(f), np.cos(psi) * np.cos(f), np.sin(f)])
        pts.append(p.copy())
    return pts


def thumb_points(d, state):
    abd, fl, cross = {"ext": (d.u(.6, 1.2), d.u(0, .3), d.u(0, .3)),
                      "mid": (d.u(.4, .8), d.u(.3, .6), d.u(.4, .9)),
                      "tuck": (d.u(.1, .5), d.u(.5, .9), d.u(1.2, 2.0))}[state]
    return thumb_chain(abd, fl, cross)


_GRID = []
def thumb_grid():
    if not _GRID:
        for a in np.linspace(0, 1.4, 8):
            for f in np.linspace(0, 1.2, 7):
                for c in np.linspace(0, 1.6, 6):
                    _GRID.append(((a, f, c), thumb_chain(a, f, c)[-1]))
    return _GRID


def assemble(d, states, thumb_state, extra, alphas=None):
    pts = [np.zeros(3)] + thumb_points(d, thumb_state)
    for k in FINGERS:
        a = alphas[k] if alphas and k in alphas else flex(d, states[k])
        pts += finger_points(k, a, FINGERS[k]["splay"] + extra.get(k, 0.0))
    return np.array(pts)


def pinch_pose(d, gap):
    states = {k: d.pick(["E", "C", "H"], [.5, .3, .2]) for k in ("middle", "ring", "pinky")}
    if d.c: states = {"middle": "H", "ring": "H", "pinky": "H"}
    idx = finger_points("index", [d.u(.7, 1.1), d.u(.7, 1.1), d.u(.3, .6)], FINGERS["index"]["splay"])
    # choose a thumb pose that already reaches the index tip (as a real thumb would), then close the remainder
    grid = thumb_grid()
    dist = np.array([np.linalg.norm(t - idx[3]) for _, t in grid])
    best = np.argsort(dist)[:6]
    (abd, fl, cr), _ = grid[best[0] if d.c else d.r.choice(best)]
    P = assemble(d, states, "mid", {}, {"index": [d.u(.7, 1.1), d.u(.7, 1.1), d.u(.3, .6)]})
    P[1:5] = thumb_chain(abd, fl, cr)
    P[5:9] = idx
    off = P[8] - P[4]
    if not d.c:
        v = d.r.normal(size=3); off = off + v / np.linalg.norm(v) * gap
    for i, w in ((2, .35), (3, .7), (4, 1.0)):     # drag the thumb chain to meet the index tip
        P[i] += off * w
    return P


def build(label, d):
    E, C = "E", "C"
    if label == "open":
        st = dict(index=E, middle=E, ring=E, pinky=E)
        ex = dict(index=d.u(0, .15), middle=d.u(-.05, .05), ring=d.u(-.12, 0), pinky=d.u(-.15, 0))
        return assemble(d, st, d.pick(["ext", "mid", "tuck"], [.6, .3, .1]), ex)
    if label == "peace":
        st = dict(index=E, middle=E, ring=d.pick([C, "H"], [.85, .15]), pinky=d.pick([C, "H"], [.85, .15]))
        ex = dict(index=d.u(.03, .22), middle=-d.u(0, .1))
        return assemble(d, st, d.pick(["tuck", "mid", "ext"], [.7, .25, .05]), ex)
    if label == "fist":
        st = {k: d.pick([C, "H"], [.9, .1]) for k in FINGERS}
        return assemble(d, st, d.pick(["tuck", "mid", "ext"], [.55, .35, .1]), {})
    if label == "yo":
        st = dict(index=E, middle=C, ring=d.pick([C, "H"], [.85, .15]), pinky=E)
        ex = dict(index=d.u(0, .15), pinky=-d.u(0, .2))
        return assemble(d, st, d.pick(["tuck", "ext", "mid"], [.5, .4, .1]), ex)
    if label == "pinch":
        return pinch_pose(d, d.u(0.0, 0.2))
    # "other": random finger combinations that are not one of the named gestures,
    # plus open "C"/near-pinch shapes that must not count as a pinch
    if d.chance(.15):
        return pinch_pose(d, d.u(.4, 1.0))
    while True:
        st = {k: d.pick([E, C, "H"], [.4, .4, .2]) for k in FINGERS}
        if "".join(st[k][0] for k in FINGERS) not in ("EEEE", "EECC", "CCCC", "ECCE"):
            break
    return assemble(d, st, d.pick(["ext", "mid", "tuck"], [.35, .35, .3]), {})


def rot(yaw, pitch, roll):
    cy, sy, cp, sp, cr, sr = np.cos(yaw), np.sin(yaw), np.cos(pitch), np.sin(pitch), np.cos(roll), np.sin(roll)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    Rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    return Rz @ Rx @ Ry


def view(P, d):
    """Left/right hand, random camera angle and distance, tracker jitter -> normalised landmarks."""
    P = P.copy()
    if d.chance(.5): P[:, 0] *= -1
    yaw = d.n(0, .45) + (np.pi if d.chance(.12) else 0)
    P = P @ rot(yaw, d.n(0, .4), d.n(0, .45)).T
    S = d.u(70, 260)                                   # hand size in pixels on a 640x480 frame
    Q = np.stack([P[:, 0] * S / 640, -P[:, 1] * S / 480, -P[:, 2] * S / 640], 1)   # MediaPipe: y down, z toward camera < 0
    Q = Q + d.r.normal(0, [.003, .003, .008], Q.shape)
    return Q


def features(Q):
    size = np.linalg.norm(Q[9] - Q[0]) or 1e-3
    return ((Q - Q[0]) / size).flatten().astype(np.float32)


def make_dataset(n_per_class, seed=0):
    d = Dice(seed)
    X, y = [], []
    for li, lab in enumerate(LABELS):
        for _ in range(n_per_class):
            X.append(features(view(build(lab, d), d))); y.append(li)
    return np.array(X), np.array(y)


def canonical_2d(label):
    """Clean 3/4-view drawing of a gesture, scaled to a 0..1 box (for the Learn tab)."""
    P = build(label, Dice(canon=True)) @ rot(0.3, 0.12, 0.0).T
    xy = np.stack([P[:, 0], -P[:, 1]], 1); xy -= xy.min(0); xy /= xy.max()   # image coordinates, y down
    return xy + (1 - xy.max(0)) / 2


if __name__ == "__main__":
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    BONES = [(0,1),(1,2),(2,3),(3,4),(0,5),(5,6),(6,7),(7,8),(9,10),(10,11),(11,12),(13,14),(14,15),(15,16),(0,17),(17,18),(18,19),(19,20),(5,9),(9,13),(13,17)]
    fig, ax = plt.subplots(3, 6, figsize=(13, 6.8))
    d = Dice(3)
    for c, lab in enumerate(LABELS):
        pts = [canonical_2d(lab) if lab != "other" else None] + [view(build(lab, d), d)[:, :2] * [640, 480] for _ in range(2)]
        for r in range(3):
            a = ax[r, c]; a.set_aspect("equal"); a.axis("off")
            p = pts[r]
            if p is None: a.text(.5, .5, "random mixes", ha="center", transform=a.transAxes); continue
            a.invert_yaxis()
            for i, j in BONES: a.plot(*zip(p[i], p[j]), c="#2f5d8a", lw=2)
            a.scatter(p[:, 0], p[:, 1], s=9, c="#242b30", zorder=3)
            if r == 0: a.set_title(lab, fontsize=12)
    fig.suptitle("Synthetic hand model: reference pose (top) and two random views per gesture", y=.995)
    fig.tight_layout(); fig.savefig("reports/gesture_samples.png", dpi=110)
    json.dump({l: np.round(canonical_2d(l), 3).tolist() for l in LABELS if l != "other"}, open("reports/gesture_poses.json", "w"))
    print("saved gesture_samples.png, gesture_poses.json")
