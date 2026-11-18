"""Record your own gesture dataset (optional: it is added to the synthetic data when you run train.py).
Keys 1-6 start/stop recording a class, Q quits.
1=open  2=pinch  3=peace  4=fist  5=yo  6=other (pointing, half-open, random poses, transitions)
Aim for 600+ frames per class. Vary distance, angle, lighting, and use BOTH hands."""
import csv, os, cv2, numpy as np, mediapipe as mp

LABELS = ["open", "pinch", "peace", "fist", "yo", "other"]
OUT = "data/landmarks.csv"
os.makedirs("data", exist_ok=True)

def features(lm):
    """21 landmarks -> 63 numbers, wrist-centred and scaled by hand size (must match index.html)."""
    p = np.array([[l.x, l.y, l.z] for l in lm.landmark], dtype=np.float32)
    size = np.linalg.norm(p[9] - p[0]) or 1e-3
    return ((p - p[0]) / size).flatten()

hands = mp.solutions.hands.Hands(max_num_hands=1, model_complexity=1,
                                 min_detection_confidence=0.7, min_tracking_confidence=0.7)
draw = mp.solutions.drawing_utils
cap = cv2.VideoCapture(0)
counts = {l: 0 for l in LABELS}
active = None
new_file = not os.path.exists(OUT)
with open(OUT, "a", newline="") as f:
    w = csv.writer(f)
    while cap.isOpened():
        ok, frame = cap.read()
        if not ok:
            break
        res = hands.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))   # raw (un-flipped) frame, like the web app
        if res.multi_hand_landmarks:
            lm = res.multi_hand_landmarks[0]
            draw.draw_landmarks(frame, lm, mp.solutions.hands.HAND_CONNECTIONS)
            if active:
                w.writerow([active] + features(lm).round(5).tolist())
                counts[active] += 1
        view = cv2.flip(frame, 1)
        cv2.putText(view, f"recording: {active or '-'}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
        cv2.putText(view, "  ".join(f"{i+1}:{l}={counts[l]}" for i, l in enumerate(LABELS)),
                    (10, 465), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        cv2.imshow("GestureCraft - collect data", view)
        k = cv2.waitKey(1) & 0xFF
        if k == ord("q"):
            break
        if ord("1") <= k <= ord("6"):
            lab = LABELS[k - ord("1")]
            active = None if active == lab else lab
cap.release(); cv2.destroyAllWindows()
print("Saved to", OUT, counts)
