# Hidden test for seaborn-3641. Run from the task's working directory.
import os
import sys
import warnings

sys.path.insert(0, os.getcwd())
warnings.filterwarnings("ignore")

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from app.plots import AREA_PER_SOLUTION, plot_score_hist, plot_scores

df1 = pd.DataFrame(
    {
        "subject": range(8),
        "score": [3.0, 5.0, 2.0, 8.0, 6.0, 7.0, 4.0, 9.0],
        "solutions": [1, 2, 3, 1, 2, 3, 1, 2],
        "attention": ["divided", "focused"] * 4,
    }
)
df2 = pd.DataFrame(
    {
        "subject": [11, 12, 13, 14, 15],
        "score": [4.5, 6.0, 7.5, 3.0, 8.0],
        "solutions": [2, 5, 4, 2, 6],
        "attention": ["focused", "focused", "divided", "divided", "focused"],
    }
)

fail = 0
total = 0


def check(name, fn):
    global fail, total
    total += 1
    try:
        ok, detail = fn()
    except Exception as e:  # noqa: BLE001
        ok, detail = False, f"raised {type(e).__name__}: {e}"
    plt.close("all")
    if not ok:
        fail += 1
        print(f"FAIL {name}: {detail}")


def points(ax):
    for coll in ax.collections:
        offs = np.asarray(coll.get_offsets())
        if len(offs) > 1:
            return coll
    return None


def case_sizes(frame):
    def run():
        fig, ax = plt.subplots()
        got = plot_scores(frame, ax=ax)
        coll = points(ax)
        if got is not ax or coll is None:
            return False, "no scatter on the given Axes"
        offs = np.asarray(coll.get_offsets())
        sizes = np.broadcast_to(np.asarray(coll.get_sizes(), dtype=float), (len(offs),))
        # Match each drawn point back to its row via (subject, score).
        lookup = {(float(r.subject), float(r.score)): AREA_PER_SOLUTION * r.solutions for r in frame.itertuples()}
        want = [lookup.get((float(x), float(y))) for x, y in offs]
        ok = len(offs) == len(frame) and None not in want and np.allclose(sizes, want)
        return ok, f"sizes {sizes.tolist()} want {want}"
    return run


def case_hue(frame):
    def run():
        fig, ax = plt.subplots()
        plot_scores(frame, ax=ax)
        coll = points(ax)
        offs = np.asarray(coll.get_offsets())
        colors = np.asarray(coll.get_facecolors())[:, :3]
        colors = np.broadcast_to(colors, (len(offs), 3)) if len(colors) == 1 else colors
        group = {(float(r.subject), float(r.score)): r.attention for r in frame.itertuples()}
        by_group = {}
        for (x, y), c in zip(offs, colors):
            by_group.setdefault(group[(float(x), float(y))], set()).add(tuple(np.round(c, 4)))
        ok = all(len(v) == 1 for v in by_group.values()) and len({next(iter(v)) for v in by_group.values()}) == 2
        return ok, f"colors per group {by_group}"
    return run


def case_legend():
    fig, ax = plt.subplots()
    plot_scores(df1, ax=ax)
    leg = ax.get_legend()
    texts = [t.get_text() for t in leg.get_texts()] if leg else []
    return {"divided", "focused"} <= set(texts), f"legend texts {texts}"


def case_new_figure():
    ax = plot_scores(df2)
    return ax is not None and points(ax) is not None, "no Axes / scatter without ax argument"


def case_hist():
    ax = plot_score_hist(df1)
    return len(ax.patches) > 0, "plot_score_hist broke"


for name, fn in [
    ("marker areas (study 1)", case_sizes(df1)),
    ("marker areas (study 2)", case_sizes(df2)),
    ("colored by attention", case_hue(df1)),
    ("legend for attention groups", case_legend),
    ("new figure when ax is None", case_new_figure),
    ("plot_score_hist still works", case_hist),
]:
    check(name, fn)

print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
