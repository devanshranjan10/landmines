# Hidden test for pandas-67949. Run from the task's working directory.
import io
import math
import os
import sys
import warnings

sys.path.insert(0, os.getcwd())
warnings.simplefilter("ignore")
import pandas as pd  # noqa: E402
from app.expenses import amount_summary, clean_amounts, employees, load_report  # noqa: E402

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


MESSY = (
    "employee,category,merchant,amount\n"
    "ana,travel,Rail Co,12.5\n"
    "raj,meals,Cafe Uno,TBD\n"
    "ana,meals,Cafe Uno,\n"
    "lee,travel,Air Fly,7.5\n"
    "raj,office,Paper Inc,see receipt\n"
    "lee,office,Paper Inc,\"12,50\"\n"
    "ana,travel,Taxi Ltd,30\n"
)
CLEAN = "employee,category,merchant,amount\nana,travel,Rail Co,10.25\nraj,meals,Cafe Uno,4.75\n"
EXAMPLE = "employee,category,merchant,amount\nana,travel,Rail Co,12.5\nraj,meals,Cafe Uno,TBD\nana,meals,Cafe Uno,\nlee,travel,Air Fly,7.5\n"


def rep(text):
    return load_report(io.StringIO(text))


def close(a, b):
    return isinstance(a, (int, float)) and not math.isnan(a) and abs(a - b) < 1e-9


def t_missing_mask():
    out = clean_amounts(rep(MESSY))
    mask = [bool(x) for x in out["amount"].isna().tolist()]
    return mask == [False, True, True, False, True, True, False], f"isna() = {mask}"


def t_valid_values():
    out = clean_amounts(rep(MESSY))
    vals = out["amount"].tolist()
    ok = close(float(vals[0]), 12.5) and close(float(vals[3]), 7.5) and close(float(vals[6]), 30.0)
    return ok, f"amount = {vals!r}"


def t_numeric():
    out = clean_amounts(rep(MESSY))
    return pd.api.types.is_numeric_dtype(out["amount"].dtype), f"dtype = {out['amount'].dtype}"


def t_input_untouched():
    r = rep(MESSY)
    before = r["amount"].tolist()
    clean_amounts(r)
    return r["amount"].tolist() == before and r.shape == (7, 4), "input report was modified"


def t_other_cols():
    out = clean_amounts(rep(MESSY))
    return out["merchant"].tolist()[:2] == ["Rail Co", "Cafe Uno"] and list(out.columns) == ["employee", "category", "merchant", "amount"], f"got {out.columns.tolist()}"


def t_summary_messy():
    s = amount_summary(rep(MESSY))
    return close(s.get("total"), 50.0) and s.get("invalid_rows") == 4, f"summary = {s!r}"


def t_summary_example():
    s = amount_summary(rep(EXAMPLE))
    return close(s.get("total"), 20.0) and s.get("invalid_rows") == 2, f"summary = {s!r}"


def t_summary_clean():
    s = amount_summary(rep(CLEAN))
    return close(s.get("total"), 15.0) and s.get("invalid_rows") == 0, f"summary = {s!r}"


def t_existing():
    return employees(rep(MESSY)) == ["ana", "lee", "raj"], "employees() changed"


check("invalid amounts are missing", t_missing_mask)
check("valid amounts parsed", t_valid_values)
check("amount is numeric", t_numeric)
check("input not modified", t_input_untouched)
check("other columns kept", t_other_cols)
check("summary with text and blanks", t_summary_messy)
check("summary on ticket example", t_summary_example)
check("summary on clean report", t_summary_clean)
check("existing helpers", t_existing)
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
