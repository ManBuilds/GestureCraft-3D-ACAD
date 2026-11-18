"""Train the gesture classifier and export model.json for the web app.

Training data = synthetic hand-skeleton samples (hand_synth.py)
              + your own recordings from collect_data.py, if data/landmarks.csv exists
                (real samples are mirrored and repeated so they carry weight).

Uses PyTorch when installed; otherwise a NumPy implementation of the same 63-128-64-6 network,
so the project trains anywhere. Prints validation accuracy and writes training_report.png.
"""
import csv, json, os, time
import numpy as np
from hand_synth import LABELS, make_dataset

N_PER_CLASS, EPOCHS, SEED = 5000, 60, 0
REAL_REPEAT = 4
DIMS = [63, 128, 64, len(LABELS)]


def load_real():
    path = "data/landmarks.csv"
    if not os.path.exists(path):
        return None, None
    rows = [r for r in csv.reader(open(path)) if r and r[0] in LABELS]
    if not rows:
        return None, None
    X = np.array([[float(v) for v in r[1:]] for r in rows], dtype=np.float32)
    y = np.array([LABELS.index(r[0]) for r in rows])
    mirrored = X.copy(); mirrored[:, 0::3] *= -1            # a left hand is a mirrored right hand
    return np.vstack([X, mirrored]), np.concatenate([y, y])


# ---------- NumPy backend ----------
def train_numpy(Xtr, ytr, Xva, yva):
    rng = np.random.default_rng(SEED)
    W = [rng.normal(0, np.sqrt(2 / i), (o, i)).astype(np.float32) for i, o in zip(DIMS[:-1], DIMS[1:])]
    b = [np.zeros(o, np.float32) for o in DIMS[1:]]
    params = W + b
    m = [np.zeros_like(p) for p in params]; v = [np.zeros_like(p) for p in params]; t = 0

    def forward(X):
        acts = [X]
        for k in range(3):
            z = acts[-1] @ W[k].T + b[k]
            acts.append(np.maximum(z, 0) if k < 2 else z)
        return acts

    hist = []
    for ep in range(1, EPOCHS + 1):
        lr = 2e-3 * (0.5 * (1 + np.cos(np.pi * ep / EPOCHS))) + 1e-5
        idx = rng.permutation(len(Xtr)); losses = []
        for i in range(0, len(idx), 256):
            bi = idx[i:i + 256]; xb, yb = Xtr[bi], ytr[bi]
            acts = forward(xb)
            z = acts[-1] - acts[-1].max(1, keepdims=True); p = np.exp(z); p /= p.sum(1, keepdims=True)
            losses.append(-np.log(p[np.arange(len(yb)), yb] + 1e-9).mean())
            g = p; g[np.arange(len(yb)), yb] -= 1; g /= len(yb)
            gW, gb = [None] * 3, [None] * 3
            for k in (2, 1, 0):
                gW[k] = g.T @ acts[k] + 1e-4 * W[k]; gb[k] = g.sum(0)
                if k: g = (g @ W[k]) * (acts[k] > 0)
            t += 1
            for j, (p_, g_) in enumerate(zip(params, gW + gb)):
                m[j] = 0.9 * m[j] + 0.1 * g_; v[j] = 0.999 * v[j] + 0.001 * g_ ** 2
                p_ -= lr * (m[j] / (1 - 0.9 ** t)) / (np.sqrt(v[j] / (1 - 0.999 ** t)) + 1e-8)
        acc = (forward(Xva)[-1].argmax(1) == yva).mean()
        hist.append((float(np.mean(losses)), float(acc)))
        if ep % 10 == 0 or ep == 1:
            print(f"epoch {ep:3d}  loss {hist[-1][0]:.4f}  val acc {acc:.4f}")
    return W, b, hist, lambda X: forward(X)[-1].argmax(1)


# ---------- PyTorch backend ----------
def train_torch(Xtr, ytr, Xva, yva):
    import torch, torch.nn as nn
    torch.manual_seed(SEED)
    net = nn.Sequential(nn.Linear(63, 128), nn.ReLU(), nn.Dropout(0.1),
                        nn.Linear(128, 64), nn.ReLU(), nn.Dropout(0.1), nn.Linear(64, len(LABELS)))
    opt = torch.optim.Adam(net.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, EPOCHS)
    Xt, yt = torch.tensor(Xtr), torch.tensor(ytr); Xv, yv = torch.tensor(Xva), torch.tensor(yva)
    hist = []
    for ep in range(1, EPOCHS + 1):
        net.train(); idx = torch.randperm(len(Xt)); losses = []
        for i in range(0, len(idx), 256):
            bi = idx[i:i + 256]
            opt.zero_grad(); loss = nn.functional.cross_entropy(net(Xt[bi]), yt[bi]); loss.backward(); opt.step()
            losses.append(loss.item())
        sched.step(); net.eval()
        with torch.no_grad():
            acc = (net(Xv).argmax(1) == yv).float().mean().item()
        hist.append((float(np.mean(losses)), acc))
        if ep % 10 == 0 or ep == 1:
            print(f"epoch {ep:3d}  loss {hist[-1][0]:.4f}  val acc {acc:.4f}")
    lin = [m for m in net if isinstance(m, nn.Linear)]
    torch.save(net.state_dict(), "weights/gesture_mlp.pt")
    def predict(X):
        with torch.no_grad(): return net(torch.tensor(X)).argmax(1).numpy()
    return [l.weight.detach().numpy() for l in lin], [l.bias.detach().numpy() for l in lin], hist, predict


def main():
    os.makedirs("weights", exist_ok=True); os.makedirs("reports", exist_ok=True)
    t0 = time.time()
    Xs, ys = make_dataset(N_PER_CLASS, seed=1)
    Xr, yr = load_real()
    rng = np.random.default_rng(SEED)
    p = rng.permutation(len(Xs)); cut = int(0.85 * len(Xs))
    Xtr, ytr, Xva, yva = Xs[p[:cut]], ys[p[:cut]], Xs[p[cut:]], ys[p[cut:]]
    n_real = 0
    if Xr is not None:
        q = rng.permutation(len(Xr)); rc = int(0.85 * len(Xr))
        n_real = len(Xr) // 2
        Xtr = np.vstack([Xtr] + [Xr[q[:rc]]] * REAL_REPEAT); ytr = np.concatenate([ytr] + [yr[q[:rc]]] * REAL_REPEAT)
        Xva = np.vstack([Xva, Xr[q[rc:]]]); yva = np.concatenate([yva, yr[q[rc:]]])
    print(f"synthetic {len(Xs)} samples" + (f" + {n_real} real recordings" if n_real else " (no real recordings found)"))
    try:
        import torch; backend = "pytorch"; fn = train_torch
    except ImportError:
        backend = "numpy"; fn = train_numpy
    print("backend:", backend)
    W, b, hist, predict = fn(Xtr.astype(np.float32), ytr, Xva.astype(np.float32), yva)

    pred = predict(Xva.astype(np.float32)); k = len(LABELS)
    cm = np.zeros((k, k), int)
    for a, c in zip(yva, pred): cm[a, c] += 1
    acc = float((pred == yva).mean())
    print("\nConfusion matrix (rows = true, cols = predicted):", LABELS); print(cm)
    print("per-class recall:", {l: round(cm[i, i] / max(cm[i].sum(), 1), 3) for i, l in enumerate(LABELS)})
    print(f"overall validation accuracy: {acc:.4f}")

    source = "synthetic data" if not n_real else f"synthetic + {n_real} real"
    json.dump({"labels": LABELS, "backend": backend, "source": source, "val_accuracy": round(acc, 4),
               "layers": [{"W": np.round(w, 5).tolist(), "b": np.round(c, 5).tolist()} for w, c in zip(W, b)]},
              open("weights/gesture_mlp.json", "w"))

    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 3, figsize=(15, 4.4))
    ax[0].plot([h[0] for h in hist], c="#2f5d8a"); ax[0].set_title("Training loss"); ax[0].set_xlabel("epoch")
    ax[1].plot([h[1] for h in hist], c="#c8362b"); ax[1].set_title("Validation accuracy"); ax[1].set_xlabel("epoch")
    ax[2].imshow(cm, cmap="Blues"); ax[2].set_title("Confusion matrix (validation)")
    ax[2].set_xticks(range(k), LABELS, rotation=40); ax[2].set_yticks(range(k), LABELS)
    ax[2].set_xlabel("predicted"); ax[2].set_ylabel("true")
    for i in range(k):
        for j in range(k): ax[2].text(j, i, cm[i, j], ha="center", va="center", color="white" if cm[i, j] > cm.max() / 2 else "black", fontsize=8)
    fig.suptitle(f"GestureCraft gesture classifier ({backend}, {source}), validation accuracy {acc:.3f}")
    fig.tight_layout(); fig.savefig("reports/training_report.png", dpi=110)
    print(f"\nSaved model.json and training_report.png in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
