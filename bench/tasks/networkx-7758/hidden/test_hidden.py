# Hidden test for networkx-7758. Run from the task's working directory.
import os
import sys

sys.path.insert(0, os.getcwd())
from app.transit import build_network, contains_pattern, same_layout  # noqa: E402

fail = 0
total = 0


def check(name, network, pattern, want):
    global fail, total
    total += 1
    try:
        got = contains_pattern(build_network(network), build_network(pattern))
    except Exception as e:  # noqa: BLE001
        got = f"raised {type(e).__name__}: {e}"
    if got is not want and got != want:
        fail += 1
        print(f"FAIL {name}: got {got!r}, want {want!r}")


CITY = [
    ("Central", "Harbor", "Red"),
    ("Central", "Harbor", "Blue"),
    ("Harbor", "Airport", "Green"),
    ("Central", "Museum", "Red"),
    ("Museum", "Park", "Yellow"),
    ("Park", "Harbor", "Yellow"),
]

check("ticket example (Red+Blue then Green)", CITY,
      [("X", "Y", "Red"), ("X", "Y", "Blue"), ("Y", "Z", "Green")], True)
check("single Red segment where Red and Blue share the track", [("A", "B", "Red"), ("A", "B", "Blue")],
      [("p", "q", "Red")], True)
check("Red then Green (extra Blue between first pair)", CITY,
      [("X", "Y", "Red"), ("Y", "Z", "Green")], True)
check("Yellow path of two segments", CITY,
      [("X", "Y", "Yellow"), ("Y", "Z", "Yellow")], True)
check("line that does not exist", CITY, [("X", "Y", "Purple")], False)
check("Red+Green on the same pair does not exist", CITY,
      [("X", "Y", "Red"), ("X", "Y", "Green")], False)
check("Green+Green chain does not exist", CITY,
      [("X", "Y", "Green"), ("Y", "Z", "Green")], False)

total += 1
if not same_layout(build_network([("a", "b", "Red")]), build_network([("x", "y", "Red")])):
    fail += 1
    print("FAIL same_layout regression")

print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
