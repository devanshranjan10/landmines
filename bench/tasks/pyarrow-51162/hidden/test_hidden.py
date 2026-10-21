# Hidden test for pyarrow-51162. Run from the task's working directory.
import os
import sys
import warnings

sys.path.insert(0, os.getcwd())
warnings.simplefilter("ignore")
import pyarrow as pa  # noqa: E402
from app.ledger import Ledger  # noqa: E402

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


RECORDS = [
    {"account": "4000-sales", "amount": 1200.0, "qty": 3},
    {"account": "5000-cogs", "amount": -450.5, "qty": 3},
    {"account": "6100-travel", "amount": -89.9, "qty": 1},
]


def fresh():
    return Ledger.from_records([dict(r) for r in RECORDS])


def t_shape():
    t = fresh().snapshot()
    ok = isinstance(t, pa.Table) and t.column_names == ["account", "amount", "qty"] and t.num_rows == 3
    return ok, f"got {type(t).__name__} {getattr(t, 'column_names', None)}"


def t_values():
    t = fresh().snapshot().to_pydict()
    want = {"account": ["4000-sales", "5000-cogs", "6100-travel"], "amount": [1200.0, -450.5, -89.9], "qty": [3, 3, 1]}
    return t == want, f"snapshot = {t}"


def t_amount_frozen():
    led = fresh()
    snap = led.snapshot()
    led.correct_amount(0, 1150.0)
    got = snap.column("amount").to_pylist()
    return got == [1200.0, -450.5, -89.9], f"snapshot amount after correction = {got}"


def t_qty_frozen():
    led = fresh()
    snap = led.snapshot()
    led.adjust_qty(1, 2)
    got = snap.column("qty").to_pylist()
    return got == [3, 3, 1], f"snapshot qty after adjustment = {got}"


def t_two_snapshots():
    led = fresh()
    led.correct_amount(2, -95.0)
    first = led.snapshot()
    led.correct_amount(2, -99.0)
    second = led.snapshot()
    led.correct_amount(2, -100.0)
    a = first.column("amount").to_pylist()[2]
    b = second.column("amount").to_pylist()[2]
    return (a, b) == (-95.0, -99.0), f"snapshots show {(a, b)}, expected (-95.0, -99.0)"


def t_ledger_still_editable():
    led = fresh()
    led.snapshot()
    led.correct_amount(0, 1000.0)
    led.adjust_qty(0, 1)
    ok = abs(led.balance() - (1000.0 - 450.5 - 89.9)) < 1e-9 and int(led.df.loc[0, "qty"]) == 4
    return ok, f"balance = {led.balance()}, qty = {led.df.loc[0, 'qty']}"


check("snapshot is a Table with the right columns", t_shape)
check("snapshot values", t_values)
check("amount correction after snapshot", t_amount_frozen)
check("qty adjustment after snapshot", t_qty_frozen)
check("successive snapshots", t_two_snapshots)
check("ledger keeps working", t_ledger_still_editable)
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
