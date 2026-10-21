# Hidden test for numpy-27674. Run from the task's working directory.
import math, os, sys, warnings
sys.path.insert(0, os.getcwd())
warnings.simplefilter("ignore")
from app.sensors import channel_span, channel_summary

fail = 0
total = 0


def check(cond, msg):
    global fail, total
    total += 1
    if not cond:
        fail += 1
        print("FAIL", msg)


nan, inf = float("nan"), float("inf")
cases = [
    ([1.5, 4.0, -2.0], 6.0),
    ([20.0, 20.0, 20.0], 0.0),
    ([nan, 5, 10, 5, 10], 5.0),
    ([3.0, inf, 7.0, nan], 4.0),
    ([12.5, 13.0, nan, 11.75, -inf], 1.25),
]
for samples, want in cases:
    try:
        got = channel_span(samples)
    except Exception as e:  # noqa: BLE001
        check(False, f"channel_span({samples}) raised {type(e).__name__}: {e}")
        continue
    check(isinstance(got, float) and not math.isnan(got) and abs(got - want) < 1e-9, f"channel_span({samples}) = {got!r}, want {want}")

try:
    s = channel_summary([nan, 2.0, 4.0])
    check(abs(s["mean"] - 3.0) < 1e-9 and abs(s["span"] - 2.0) < 1e-9, f"channel_summary = {s}")
except Exception as e:  # noqa: BLE001
    check(False, f"channel_summary raised {type(e).__name__}: {e}")

print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
