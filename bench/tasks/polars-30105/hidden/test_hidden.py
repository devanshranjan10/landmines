# Hidden test for polars-30105. Run from the task's working directory.
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.getcwd())
import polars as pl  # noqa: E402

from app.window import SCHEMA, EventWindow  # noqa: E402

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


T0 = datetime(2026, 10, 1, 8, 0, 0)
USERS = ["ana", "ben", "chen", "dora", "eli"]
REVIEWED = [None, True, False, None, None, True, None]


def make_events(start, n):
    rows = []
    for i in range(start, start + n):
        rows.append({
            "event_id": i,
            "ts": T0 + timedelta(seconds=7 * i),
            "user": USERS[i % len(USERS)],
            "success": (i * 7) % 3 != 0,
            "reviewed": REVIEWED[i % len(REVIEWED)],
        })
    return rows


def batch(rows, shuffle_cols=False):
    df = pl.DataFrame(rows, schema=SCHEMA)
    if shuffle_cols:
        df = df.select("reviewed", "user", "ts", "success", "event_id").with_columns(source=pl.lit("collector-2"))
    return df


def frame_rows(w):
    f = w.frame()
    return [dict(zip(SCHEMA.names(), r)) for r in f.select(list(SCHEMA)).rows()]


def run_window(max_rows, batch_sizes, shuffle_cols=False):
    """Feed batches, return list of (window rows, expected rows) after every append."""
    w = EventWindow(max_rows=max_rows)
    seen = []
    snaps = []
    nxt = 0
    for k, size in enumerate(batch_sizes):
        rows = make_events(nxt, size)
        nxt += size
        seen.extend(rows)
        w.append(batch(rows, shuffle_cols=shuffle_cols and k % 2 == 1))
        snaps.append((w, frame_rows(w), seen[-max_rows:]))
    return snaps


def first_mismatch(got, exp):
    if len(got) != len(exp):
        return f"{len(got)} rows, expected {len(exp)}"
    for g, e in zip(got, exp):
        if g != e:
            return f"row {g} != expected {e}"
    return None


def t_under_cap():
    snaps = run_window(1000, [5, 4, 6], shuffle_cols=True)
    for i, (_, got, exp) in enumerate(snaps):
        m = first_mismatch(got, exp)
        if m:
            return False, f"after append {i + 1}: {m}"
    return True, ""


def t_cap_contents():
    snaps = run_window(8, [3] * 12)
    for i, (_, got, exp) in enumerate(snaps):
        m = first_mismatch(got, exp)
        if m:
            return False, f"after append {i + 1}: {m}"
    return True, ""


def t_cap_contents_large():
    snaps = run_window(100, [37, 41, 29, 64, 3, 50, 77, 12])
    for i, (_, got, exp) in enumerate(snaps):
        m = first_mismatch(got, exp)
        if m:
            return False, f"after append {i + 1}: {m}"
    return True, ""


def t_cap_len_ids():
    snaps = run_window(10, [4] * 9)
    w, got, exp = snaps[-1]
    ids = [r["event_id"] for r in got]
    ok = len(w) == 10 and ids == list(range(26, 36))
    return ok, f"len={len(w)} ids={ids}"


def t_aggregates_after_cap():
    snaps = run_window(9, [4] * 8)
    w, _, exp = snaps[-1]
    rate = w.failure_rate()
    exp_rate = sum(1 for r in exp if not r["success"]) / len(exp)
    pend = w.pending_review()["event_id"].to_list()
    exp_pend = [r["event_id"] for r in exp if not r["success"] and r["reviewed"] is None]
    ok = abs(rate - exp_rate) < 1e-12 and pend == exp_pend
    return ok, f"failure_rate={rate} (expected {exp_rate}), pending={pend} (expected {exp_pend})"


def t_big_batch():
    snaps = run_window(5, [2, 12, 1])
    for i, (_, got, exp) in enumerate(snaps):
        m = first_mismatch(got, exp)
        if m:
            return False, f"after append {i + 1}: {m}"
    return True, ""


check("window below the cap keeps every event", t_under_cap)
check("window contents at the cap (small batches)", t_cap_contents)
check("window contents at the cap (mixed batches)", t_cap_contents_large)
check("window length and ids at the cap", t_cap_len_ids)
check("failure_rate / pending_review after trimming", t_aggregates_after_cap)
check("batch larger than the cap", t_big_batch)
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
