# Hidden test for pandas-71282. Run from the task's working directory.
import json
import os
import sys
import warnings

sys.path.insert(0, os.getcwd())
warnings.simplefilter("ignore")
import pandas as pd  # noqa: E402
from app.scores import band_counts, load_scores, mean_by_region, score_bands  # noqa: E402

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


def export(scores):
    regions = ["north", "south", "east"]
    return json.dumps({"responses": [
        {"customer": f"c{i}", "region": regions[i % 3], "score": s} for i, s in enumerate(scores)
    ]})


MIXED = [72, "n/a", 95, 40, 60, 81.5, "n/a", 0, 100, 88, 61, "n/a", 79.5, 12]
MIXED_WANT = ["passive", None, "promoter", "detractor", "detractor", "promoter", None, "detractor",
              "promoter", "promoter", "passive", None, "passive", "detractor"]
CLEAN = [72, 95, 40, 60, 81.5]
CLEAN_WANT = ["passive", "promoter", "detractor", "detractor", "promoter"]


def labels(series):
    return [None if pd.isna(v) else str(v) for v in series.tolist()]


def t_mixed():
    got = labels(score_bands(load_scores(export(MIXED))))
    return got == MIXED_WANT, f"bands = {got}"


def t_index():
    df = load_scores(export(MIXED))
    return score_bands(df).index.equals(df.index), "index differs"


def t_counts_mixed():
    got = band_counts(load_scores(export(MIXED)))
    want = {"detractor": 4, "passive": 3, "promoter": 4}
    return got == want, f"counts = {got}"


def t_clean():
    got = labels(score_bands(load_scores(export(CLEAN))))
    return got == CLEAN_WANT, f"bands = {got}"


def t_counts_clean():
    got = band_counts(load_scores(export(CLEAN)))
    return got == {"detractor": 2, "passive": 1, "promoter": 2}, f"counts = {got}"


def t_existing():
    m = mean_by_region(load_scores(export(CLEAN)))
    return abs(m["north"] - 66.0) < 1e-9 and abs(m["south"] - 88.25) < 1e-9, f"mean_by_region = {m}"


check("bands with skipped scores", t_mixed)
check("index kept", t_index)
check("counts with skipped scores", t_counts_mixed)
check("bands without skipped scores", t_clean)
check("counts without skipped scores", t_counts_clean)
check("existing helpers", t_existing)
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
