"""The exported classifier must still work on freshly generated (unseen) samples."""
import numpy as np
from app.config import MODEL_PATH
from app.inference import GestureModel
import hand_synth as hs


def test_accuracy_on_fresh_samples():
    X, y = hs.make_dataset(100, seed=999)
    m = GestureModel(MODEL_PATH)
    pred = [m.labels.index(m.predict(x)["label"]) for x in X]
    assert np.mean(np.array(pred) == y) > 0.93


def test_rejects_bad_input():
    m = GestureModel(MODEL_PATH)
    for bad in ([0.0] * 62, [float("nan")] * 63):
        try:
            m.predict(bad); assert False
        except ValueError:
            pass
