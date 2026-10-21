# Hidden test for plotly-5792. Run from the task's working directory.
import os
import sys

sys.path.insert(0, os.getcwd())
from app.dashboard import OrderStats, comparison_figure, overview_figure  # noqa: E402

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


STATS = OrderStats(
    days=["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"],
    orders_per_day=[120, 135, 128, 150],
    by_channel={"web": 300, "app": 180, "phone": 53},
    by_region={"north": 210, "south": 190, "west": 133},
)


def axis(fig, ref, kind):
    # ref like "x", "x2", "y3" -> layout.xaxis / xaxis2 / yaxis3
    suffix = ref[1:]
    return fig.layout[f"{kind}axis{suffix}"]


def trace_box(fig, trace):
    xd = axis(fig, trace.xaxis or "x", "x").domain
    yd = axis(fig, trace.yaxis or "y", "y").domain
    return tuple(xd), tuple(yd)


def find(fig, t, **kw):
    return [tr for tr in fig.data if tr.type == t and all(getattr(tr, k) == v for k, v in kw.items())]


def t_traces():
    fig = overview_figure(STATS)
    lines = find(fig, "scatter")
    bars = find(fig, "bar")
    ok = (len(lines) == 1 and list(lines[0].x) == STATS.days and list(lines[0].y) == STATS.orders_per_day
          and len(bars) == 2)
    xs = sorted([list(b.x) for b in bars])
    ok = ok and xs == sorted([list(STATS.by_channel), list(STATS.by_region)])
    return ok, f"traces = {[(t.type, list(t.x)) for t in fig.data]}"


def layout_boxes(fig):
    line = find(fig, "scatter")[0]
    bars = find(fig, "bar")
    chan = next(b for b in bars if list(b.x) == list(STATS.by_channel))
    reg = next(b for b in bars if list(b.x) == list(STATS.by_region))
    return trace_box(fig, line), trace_box(fig, chan), trace_box(fig, reg)


def t_layout():
    fig = overview_figure(STATS)
    (lx, ly), (cx, cy), (rx, ry) = layout_boxes(fig)
    ok = (ly[0] > cy[1] and abs(cy[0] - ry[0]) < 1e-9 and cx[1] < rx[0]
          and lx[0] <= cx[0] + 1e-9 and lx[1] >= rx[1] - 1e-9)
    return ok, f"line={lx, ly} channel={cx, cy} region={rx, ry}"


def t_row_titles():
    fig = overview_figure(STATS)
    (lx, ly), (cx, cy), (rx, ry) = layout_boxes(fig)
    right = max(lx[1], rx[1])
    anns = {a.text: a for a in fig.layout.annotations if a.text in ("Trend", "Breakdown")}
    problems = []
    for text, (y0, y1) in (("Trend", ly), ("Breakdown", cy)):
        a = anns.get(text)
        if a is None:
            problems.append(f"{text}: missing")
            continue
        if (a.yref or "paper") != "paper" or (a.xref or "paper") != "paper":
            problems.append(f"{text}: refs {a.xref}/{a.yref}")
            continue
        mid = (y0 + y1) / 2
        if a.y is None or abs(a.y - mid) > 0.05:
            problems.append(f"{text}: y={a.y}, row centre={mid:.3f}")
        if a.x is None or a.x < right - 0.02:
            problems.append(f"{text}: x={a.x}, plot right edge={right:.3f}")
    return not problems, "; ".join(problems) + f" (annotations: {[(a.text, a.x, a.y) for a in fig.layout.annotations]})"


def t_style():
    fig = overview_figure(STATS)
    tmpl = fig.layout.template
    return fig.layout.showlegend is False and tmpl.layout.paper_bgcolor == "white", f"showlegend={fig.layout.showlegend}"


def t_comparison():
    fig = comparison_figure(STATS, STATS, ("this week", "last week"))
    return len(fig.data) == 2, "comparison_figure broke"


check("traces", t_traces)
check("trend on top spanning both columns", t_layout)
check("row titles on the right, centred on their rows", t_row_titles)
check("template and legend", t_style)
check("comparison_figure", t_comparison)
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
