# Hidden test for networkx-8964. Run from the task's working directory.
import os
import sys

sys.path.insert(0, os.getcwd())
from app.relay import relay_plan  # noqa: E402

fail = 0
total = 0


def check(name, fn):
    global fail, total
    total += 1
    try:
        ok, detail = fn()
    except Exception as e:  # noqa: BLE001
        ok, detail = False, f"raised {type(e).__name__}: {e}"
    if not ok:
        fail += 1
        print(f"FAIL {name}: {detail}")


def plan_case(links, want, origin="origin"):
    def run():
        got = relay_plan(links, origin)
        return dict(got) == want, f"relay_plan = {got!r}, want {want!r}"
    return run


EXAMPLE = [("origin", "hub", 5), ("origin", "edge", 9), ("hub", "edge", 2)]

STAR = [
    ("origin", "fra", 4), ("origin", "ams", 6), ("origin", "par", 7),
    ("fra", "ams", 1), ("fra", "par", 3), ("ams", "par", 5), ("par", "ams", 2),
]

# A chain of regional sites whose return links are cheap.
CHAIN = [
    ("origin", "lon", 8),
    ("lon", "dub", 2), ("dub", "lon", 1),
    ("dub", "edi", 8), ("edi", "dub", 1),
]

MESH = [
    ("origin", "sea", 10), ("sea", "sfo", 10), ("sfo", "den", 1), ("den", "sfo", 1),
    ("den", "chi", 10), ("chi", "den", 3), ("sfo", "chi", 3), ("chi", "sfo", 20),
]

RING = [
    ("origin", "sea", 10), ("sea", "sfo", 10), ("sfo", "den", 3), ("den", "sea", 1),
    ("sfo", "chi", 10), ("chi", "sfo", 3),
]

UNREACH = [("origin", "a", 1), ("b", "c", 1)]


def t_unreachable():
    try:
        relay_plan(UNREACH, "origin")
    except ValueError as e:
        return "b" in str(e) and "c" in str(e), f"message = {e}"
    return False, "no ValueError"


check("ticket example", plan_case(EXAMPLE, {"hub": "origin", "edge": "hub"}))
check("star with relays", plan_case(STAR, {"fra": "origin", "ams": "fra", "par": "fra"}))
check("chain with cheap return links", plan_case(CHAIN, {"lon": "origin", "dub": "lon", "edi": "dub"}))
check("mesh", plan_case(MESH, {"sea": "origin", "sfo": "sea", "den": "sfo", "chi": "sfo"}))
check("west-coast ring", plan_case(RING, {"sea": "origin", "sfo": "sea", "den": "sfo", "chi": "sfo"}))
check("unreachable sites raise ValueError", t_unreachable)
check("single direct link", plan_case([("origin", "x", 3)], {"x": "origin"}))
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
