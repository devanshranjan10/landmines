# Hidden test for rich-4214. Run from the task's working directory.
import io
import os
import sys

sys.path.insert(0, os.getcwd())
from rich.console import Console  # noqa: E402

from app.listing import print_listing, print_tags  # noqa: E402

fail = 0
total = 0
NAMES = [f"orders_2026_{i:02d}.csv" for i in range(1, 8)]  # 18 chars each


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


def render(width, names=NAMES):
    console = Console(file=io.StringIO(), width=width, color_system=None, force_terminal=False)
    with console.capture() as cap:
        print_listing(console, names)
    return [ln.rstrip() for ln in cap.get().split("\n") if ln.strip()]


def tokens(lines):
    return [tok for ln in lines for tok in ln.split()]


def t_wide():
    ls = render(80)
    ok = tokens(ls) == NAMES and len(ls[0].split()) >= 2 and all(len(ln) <= 80 for ln in ls)
    return ok, f"lines = {ls}"


def t_aligned():
    ls = render(80)
    starts = sorted({ln.index(tok) for ln in ls for tok in ln.split()})
    gaps = {b - a for a, b in zip(starts, starts[1:])}
    ok = len(starts) >= 2 and all(g >= 24 for g in gaps) and len(gaps) == 1
    return ok, f"column starts = {starts}"


def t_medium():
    ls = render(52)
    ok = tokens(ls) == NAMES and max(len(ln.split()) for ln in ls) == 2 and all(len(ln) <= 52 for ln in ls)
    return ok, f"lines = {ls}"


def t_narrow(width):
    def run():
        ls = render(width)
        ok = ls == NAMES
        return ok, f"lines = {ls}"
    return run


def t_tags():
    console = Console(file=io.StringIO(), width=40, color_system=None, force_terminal=False)
    with console.capture() as cap:
        print_tags(console, ["prod", "eu", "daily"])
    return cap.get().split() == ["prod", "eu", "daily"], f"got {cap.get()!r}"


check("80 columns: grid", t_wide)
check("80 columns: fixed-width columns line up", t_aligned)
check("52 columns: two per row", t_medium)
check("25 columns: one per line", t_narrow(25))
check("24 columns: one per line", t_narrow(24))
check("20 columns: one per line", t_narrow(20))
check("print_tags still works", t_tags)
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
