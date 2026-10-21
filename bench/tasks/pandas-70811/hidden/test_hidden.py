# Hidden test for pandas-70811. Run from the task's working directory.
import io
import os
import sys
import warnings

sys.path.insert(0, os.getcwd())
warnings.simplefilter("ignore")
from app.survey import load_responses, team_counts, work_mode_matrix, work_mode_share  # noqa: E402

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


CSV = (
    "respondent,team,seniority,work_modes\n"
    "r1,data,senior,Remote | On site\n"
    "r2,web,junior,Remote\n"
    "r3,data,mid,\n"
    "r4,ops,senior,On site | Hybrid\n"
    "r5,web,mid,Hybrid\n"
    "r6,web,junior,Remote | Hybrid | On site\n"
    "r7,ops,mid,Remote\n"
    "r8,data,senior,On site\n"
)
SINGLE = "respondent,team,seniority,work_modes\nq1,data,mid,Remote\nq2,web,mid,Hybrid\nq3,ops,junior,Remote\n"


def load(text):
    return load_responses(io.StringIO(text))


def t_columns():
    m = work_mode_matrix(load(CSV))
    return list(m.columns) == ["Hybrid", "On site", "Remote"], f"columns = {list(m.columns)}"


def t_values():
    m = work_mode_matrix(load(CSV))
    got = {c: [int(v) for v in m[c].tolist()] for c in m.columns}
    want = {
        "Hybrid": [0, 0, 0, 1, 1, 1, 0, 0],
        "On site": [1, 0, 0, 1, 0, 1, 0, 1],
        "Remote": [1, 1, 0, 0, 0, 1, 1, 0],
    }
    return got == want, f"matrix = {got}"


def t_index():
    r = load(CSV)
    m = work_mode_matrix(r)
    return m.index.equals(r.index), "index differs from responses"


def t_share():
    s = work_mode_share(load(CSV))
    want = {"Hybrid": 3 / 8, "On site": 4 / 8, "Remote": 4 / 8}
    ok = set(s) == set(want) and all(abs(float(s[k]) - v) < 1e-9 for k, v in want.items())
    return ok, f"share = {s}"


def t_single_choice():
    m = work_mode_matrix(load(SINGLE))
    got = {c: [int(v) for v in m[c].tolist()] for c in m.columns}
    return got == {"Hybrid": [0, 1, 0], "Remote": [1, 0, 1]}, f"matrix = {got}"


def t_existing():
    return team_counts(load(CSV)) == {"data": 3, "web": 3, "ops": 2}, "team_counts changed"


check("one column per work mode", t_columns)
check("indicator values", t_values)
check("index kept", t_index)
check("work mode share", t_share)
check("single-choice answers", t_single_choice)
check("existing helpers", t_existing)
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
