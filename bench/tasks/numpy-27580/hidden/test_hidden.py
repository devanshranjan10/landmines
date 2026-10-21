# Hidden test for numpy-27580. Run from the task's working directory.
import os
import sys

sys.path.insert(0, os.getcwd())

import numpy as np

from app.sensors import sensor_means, sensor_minimums

fail = 0
total = 0


def check(name, readings, want):
    global fail, total
    total += 1
    try:
        got = sensor_minimums(np.array(readings, dtype=np.uint8))
        values = np.ma.masked_array(got).tolist()
        ok = values == want and np.ma.masked_array(got).dtype == np.uint8
        detail = f"got {values} dtype={np.ma.masked_array(got).dtype}, want {want} uint8"
    except Exception as e:  # noqa: BLE001
        ok, detail = False, f"raised {type(e).__name__}: {e}"
    if not ok:
        fail += 1
        print(f"FAIL {name}: {detail}")


check("gaps and a silent sensor", [[12, 255, 40], [9, 255, 41], [255, 255, 38]], [9, None, 38])
check("some gaps", [[30, 255], [255, 22], [31, 25]], [30, 22])
check("no gaps", [[5, 6, 7], [4, 9, 1]], [4, 6, 1])
check("single sample", [[17, 255, 0]], [17, None, 0])

total += 1
try:
    m = sensor_means(np.array([[10, 255], [20, 255]], dtype=np.uint8)).tolist()
    if m != [15.0, None]:
        fail += 1
        print(f"FAIL sensor_means still works: got {m}")
except Exception as e:  # noqa: BLE001
    fail += 1
    print(f"FAIL sensor_means still works: raised {e}")

print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
