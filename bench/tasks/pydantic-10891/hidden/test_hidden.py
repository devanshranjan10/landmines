# Hidden test for pydantic-10891. Run from the task's working directory.
import json
import math
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.getcwd())
from app.readings import Reading, export_batch, load_batch  # noqa: E402

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


T0 = datetime(2024, 5, 1, 12, 0, tzinfo=timezone.utc)
ROWS = [
    Reading(sensor_id="t-1", taken_at=T0, value=21.123456),
    Reading(sensor_id="t-1", taken_at=T0, value=math.nan),
    Reading(sensor_id="t-2", taken_at=T0, value=math.inf),
    Reading(sensor_id="t-3", taken_at=T0, value=-math.inf),
]


def raw(rows):
    out = export_batch(rows)
    return out.encode() if isinstance(out, str) else bytes(out)


def t_constants():
    text = raw(ROWS).decode("utf-8")
    ok = "NaN" in text and "Infinity" in text and "-Infinity" in text and "null" not in text
    return ok, f"batch = {text}"


def t_parsed_values():
    data = json.loads(raw(ROWS))
    vals = [row["value"] for row in data]
    ok = (len(vals) == 4 and vals[0] == 21.123 and vals[1] is not None and math.isnan(vals[1])
          and vals[2] == math.inf and vals[3] == -math.inf)
    return ok, f"values = {vals!r}"


def t_roundtrip():
    back = load_batch(raw(ROWS))
    vals = [r.value for r in back]
    ok = ([r.sensor_id for r in back] == ["t-1", "t-1", "t-2", "t-3"] and all(r.taken_at == T0 for r in back)
          and vals[0] == 21.123 and math.isnan(vals[1]) and vals[2] == math.inf and vals[3] == -math.inf)
    return ok, f"round trip values = {vals!r}"


def t_plain():
    data = json.loads(raw([Reading(sensor_id="h-9", taken_at=T0, value=55.5)]))
    ok = len(data) == 1 and data[0]["sensor_id"] == "h-9" and data[0]["value"] == 55.5
    return ok, f"got {data!r}"


def t_empty():
    return json.loads(raw([])) == [], "empty batch is not []"


check("NaN/Infinity constants in batch", t_constants)
check("parsed values", t_parsed_values)
check("load_batch round trip", t_roundtrip)
check("plain reading", t_plain)
check("empty batch", t_empty)
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
