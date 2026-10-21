# Hidden test for numpy-27540. Run from the task's working directory.
import os, sys
sys.path.insert(0, os.getcwd())
import numpy as np
from app.quality import DQ, flag_frame, has_flag, new_dq_plane

fail = 0
total = 0


def check(cond, msg):
    global fail, total
    total += 1
    if not cond:
        fail += 1
        print("FAIL", msg)


def run(label, image, dq, saturation, want):
    try:
        out = flag_frame(image, dq, saturation)
    except Exception as e:  # noqa: BLE001
        check(False, f"{label}: raised {type(e).__name__}: {e}")
        return
    check(dq.dtype == np.uint32, f"{label}: dq dtype changed to {dq.dtype}")
    check(dq.tolist() == want, f"{label}: dq = {dq.tolist()}, want {want}")
    check(out is dq or (isinstance(out, np.ndarray) and out.tolist() == want), f"{label}: returned {out!r}")


# nothing to flag
img = np.array([[10.0, 20.0], [30.0, 40.0]])
run("clean frame", img, new_dq_plane(img.shape), 1000.0, [[0, 0], [0, 0]])

# saturated + dead pixels on a fresh plane
img = np.array([[0.0, 500.0, 65535.0], [70000.0, 12.0, 0.0]])
run("fresh plane", img, new_dq_plane(img.shape), 65535.0, [[2, 0, 1], [1, 0, 2]])

# existing bits are preserved
img = np.array([100.0, 0.0, 65535.0, 7.0])
dq = np.array([DQ.HOT, DQ.COSMIC_RAY, DQ.HOT | DQ.COSMIC_RAY, 0], dtype=np.uint32)
run("existing bits", img, dq, 60000.0, [4, 10, 13, 0])

# second pass is idempotent
img = np.array([0.0, 70000.0])
dq = new_dq_plane(img.shape)
run("first pass", img, dq, 65535.0, [2, 1])
run("second pass", img, dq, 65535.0, [2, 1])
check(has_flag(dq, DQ.DEAD).tolist() == [True, False], "has_flag broken")

print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
