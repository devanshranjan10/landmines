# Hidden test for pyarrow-54534. Run from the task's working directory.
import csv
import os
import sys
import tempfile
from datetime import datetime, timezone

sys.path.insert(0, os.getcwd())
from app.climate import STATIONS, export_csv, load_station, observations, save_station  # noqa: E402

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


def u(*args):
    return datetime(*args, tzinfo=timezone.utc)


def export(station, rows, via_parquet=False):
    table = observations(station, rows)
    d = tempfile.mkdtemp(prefix="climate-")
    if via_parquet:
        save_station(table, os.path.join(d, "s.parquet"))
        table = load_station(os.path.join(d, "s.parquet"), station)
    path = os.path.join(d, f"{station}.csv")
    export_csv(table, path)
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def compare(rows, out):
    if len(out) != len(rows):
        return False, f"{len(out)} lines, expected {len(rows)}"
    for (when, tmax, tmin, precip), line in zip(rows, out):
        got = datetime.fromisoformat(line["observed_at"])
        if got.tzinfo is None:
            return False, f"observed_at {line['observed_at']!r} has no UTC offset"
        if got != when:
            return False, f"observed_at {line['observed_at']!r} is {got.astimezone(timezone.utc)} UTC, expected {when}"
        if (float(line["tmax_c"]), float(line["tmin_c"]), float(line["precip_mm"])) != (tmax, tmin, precip):
            return False, f"values {line!r}"
    return True, ""


MODERN_NYC = [(u(2024, 7, 1, 11), 31.5, 22.0, 0.0), (u(2024, 12, 15, 12), 3.5, -2.0, 4.2)]
OLD_NYC = [(u(1869, 1, 1, 12), -1.1, -8.3, 0.0), (u(1880, 6, 1, 12), 27.2, 15.0, 2.5),
           (u(1883, 11, 18, 17), 9.0, 2.0, 0.0), (u(1950, 3, 3, 12), 8.0, 1.0, 0.5)]
OLD_DUB = [(u(1880, 1, 1, 9), 6.0, 1.5, 3.1), (u(1910, 7, 14, 9), 19.4, 10.2, 0.0),
           (u(1990, 2, 2, 9), 7.7, 2.2, 6.6)]


def t_columns():
    out = export("NYC", MODERN_NYC)
    return list(out[0].keys()) == ["observed_at", "tmax_c", "tmin_c", "precip_mm"], f"header = {list(out[0].keys())}"


check("header columns", t_columns)
check("modern New York records", lambda: compare(MODERN_NYC, export("NYC", MODERN_NYC)))
check("historic New York records", lambda: compare(OLD_NYC, export("NYC", OLD_NYC)))
check("historic Dublin records", lambda: compare(OLD_DUB, export("DUB", OLD_DUB)))
check("Dublin records loaded from parquet", lambda: compare(OLD_DUB, export("DUB", OLD_DUB, via_parquet=True)))
assert set(STATIONS) == {"NYC", "DUB"}
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
