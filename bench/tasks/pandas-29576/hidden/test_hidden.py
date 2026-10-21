# Hidden test for pandas-29576. Run from the task's working directory.
import os, sys
sys.path.insert(0, os.getcwd())
import numpy as np
import pandas as pd
from app.fiscal import half_year_totals, quarterly_totals

fail = 0
total = 0


def check(cond, msg):
    global fail, total
    total += 1
    if not cond:
        fail += 1
        print("FAIL", msg)


def expected(daily):
    out = {}
    for ts, v in daily.items():
        if ts.month >= 9:
            start = pd.Timestamp(ts.year, 9, 1)
        elif ts.month >= 3:
            start = pd.Timestamp(ts.year, 3, 1)
        else:
            start = pd.Timestamp(ts.year - 1, 9, 1)
        out[start] = out.get(start, 0.0) + v
    return sorted(out.items())


def case(label, start, end):
    idx = pd.date_range(start, end, freq="D")
    daily = pd.Series(np.arange(1, len(idx) + 1, dtype=float), index=idx)
    try:
        got = half_year_totals(daily)
    except Exception as e:  # noqa: BLE001
        check(False, f"{label}: raised {type(e).__name__}: {e}")
        return
    want = expected(daily)
    got_pairs = [(pd.Timestamp(k), float(v)) for k, v in got.items() if float(v) != 0.0]
    check(
        [(k.date(), v) for k, v in got_pairs] == [(k.date(), v) for k, v in want],
        f"{label}: got {[(str(k.date()), v) for k, v in got_pairs]}, want {[(str(k.date()), v) for k, v in want]}",
    )
    check(abs(float(got.sum()) - float(daily.sum())) < 1e-6, f"{label}: totals don't add up to the input")


case("starts on a half boundary", "2023-03-01", "2024-02-29")
case("starts on a half boundary (H2)", "2023-09-01", "2024-08-31")
case("calendar years 2023-2024", "2023-01-01", "2024-12-31")
case("mid-half start", "2022-11-15", "2023-10-10")
case("starts in July", "2023-07-10", "2024-05-01")

# existing helper still works
idx = pd.date_range("2023-03-01", "2023-08-31", freq="D")
q = quarterly_totals(pd.Series(1.0, index=idx))
check([str(d.date()) for d in q.index] == ["2023-03-01", "2023-06-01"], f"quarterly_totals changed: {list(q.index)}")

print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
