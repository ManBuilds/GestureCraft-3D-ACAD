"""Gesture classifier inference (NumPy only, so the server does not need PyTorch)."""
import json
import numpy as np


class GestureModel:
    """63 features (21 landmarks x xyz, wrist-centred, scaled by hand size) -> gesture probabilities."""

    def __init__(self, path):
        d = json.load(open(path))
        self.labels = d["labels"]
        self.meta = {k: d.get(k) for k in ("source", "backend", "val_accuracy")}
        self.layers = [(np.array(l["W"], np.float32), np.array(l["b"], np.float32)) for l in d["layers"]]

    def predict(self, features):
        x = np.asarray(features, np.float32)
        if x.shape != (63,) or not np.isfinite(x).all():
            raise ValueError("expected 63 finite numbers")
        for i, (W, b) in enumerate(self.layers):
            x = W @ x + b
            if i < len(self.layers) - 1:
                x = np.maximum(x, 0)
        e = np.exp(x - x.max()); p = e / e.sum(); k = int(p.argmax())
        return {"label": self.labels[k], "confidence": float(p[k]), "probs": {l: float(v) for l, v in zip(self.labels, p)}}
