# Hidden test for pandas-71280. Run from the task's working directory.
import atexit
import io
import os
import shutil
import sys
import tempfile
import warnings

sys.path.insert(0, os.getcwd())
warnings.simplefilter("ignore")
import pandas as pd  # noqa: E402
from app.stata_export import export_daily, export_weekly, load_daily, load_weekly  # noqa: E402

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


WEEKLY = (
    "week,region,orders,revenue\n"
    "2023-12-25,north,10,250.5\n"
    "2024-01-01,north,12,300.0\n"
    "2024-06-03,south,7,99.9\n"
    "2024-12-23,north,15,410.0\n"
    "2024-12-30,north,9,205.25\n"
    "2024-12-30,south,4,80.0\n"
    "2025-01-06,north,11,260.0\n"
    "2025-12-29,south,6,120.0\n"
)


def stata_week(ts):
    """Stata %tw value: 52 weeks per year since 1960, week 52 absorbs the last days of the year."""
    return 52 * (ts.year - 1960) + min((ts.dayofyear - 1) // 7, 51)


TMP = tempfile.mkdtemp(prefix="lmb-dta-")
atexit.register(shutil.rmtree, TMP, True)


def written(text=WEEKLY):
    path = os.path.join(TMP, f"w{len(os.listdir(TMP))}.dta")
    export_weekly(load_weekly(io.StringIO(text)), path)
    return path


def raw_and_fmt(path):
    with pd.io.stata.StataReader(path) as r:
        data = r.read(convert_dates=False)
        fmts = dict(zip(data.columns, r._fmtlist))
    return data, fmts


def t_format():
    data, fmts = raw_and_fmt(written())
    return list(data.columns) == ["week", "region", "orders", "revenue"] and fmts.get("week") == "%tw", f"columns={list(data.columns)} formats={fmts}"


def t_week_values():
    data, _ = raw_and_fmt(written())
    want = [stata_week(t) for t in pd.to_datetime(load_weekly(io.StringIO(WEEKLY))["week"])]
    got = [int(v) for v in data["week"].tolist()]
    return got == want, f"stored %tw values {got}, expected {want}"


def t_year_kept():
    back = pd.read_stata(written())
    years = back["week"].dt.year.tolist()
    return years == [2023, 2024, 2024, 2024, 2024, 2024, 2025, 2025], f"years read back = {years}"


def t_ordinary_weeks():
    text = "week,region,orders,revenue\n2024-03-04,north,5,50.0\n2024-03-11,south,6,60.5\n"
    data, _ = raw_and_fmt(written(text))
    got = [int(v) for v in data["week"].tolist()]
    return got == [52 * 64 + 9, 52 * 64 + 10], f"stored %tw values {got}"


def t_other_columns():
    back = pd.read_stata(written())
    ok = back["region"].tolist()[:3] == ["north", "north", "south"] and back["orders"].tolist()[4] == 9 \
        and abs(float(back["revenue"].tolist()[4]) - 205.25) < 1e-9
    return ok, f"got {back[['region', 'orders', 'revenue']].values.tolist()[:5]}"


def t_existing():
    path = os.path.join(TMP, "daily.dta")
    export_daily(load_daily(io.StringIO("day,region,orders,revenue\n2024-12-31,north,3,30.0\n")), path)
    back = pd.read_stata(path)
    return str(back["day"].iloc[0].date()) == "2024-12-31", f"daily export read back {back.to_dict('list')}"


check("week stored as %tw", t_format)
check("Stata week values", t_week_values)
check("year preserved on read back", t_year_kept)
check("ordinary weeks", t_ordinary_weeks)
check("other columns", t_other_columns)
check("daily export unchanged", t_existing)
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
