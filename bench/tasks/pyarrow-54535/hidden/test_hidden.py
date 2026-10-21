# Hidden test for pyarrow-54535. Run from the task's working directory.
import os
import sys
import tempfile

sys.path.insert(0, os.getcwd())
from app.extracts import EXTRACT_SCHEMAS, build_extract, load_extract, save_extract  # noqa: E402

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


def roundtrip(name, columns):
    table = build_extract(name, columns)
    path = os.path.join(tempfile.mkdtemp(prefix="extract-"), f"{name}.csv")
    save_extract(table, path)
    back = load_extract(path, name)
    return table, back


def same(name, columns):
    table, back = roundtrip(name, columns)
    ok = back.schema.equals(EXTRACT_SCHEMAS[name]) and back.to_pydict() == table.to_pydict()
    return ok, f"wrote {table.to_pydict()}, read {back.to_pydict()} ({back.schema})"


check("revenue extract", lambda: same("revenue", {
    "account_id": [101, 102, 103, 104], "mrr": [49.0, None, 1250.5, 0.0], "seats": [3, 1, None, 0]}))
check("usage extract with a fully missing row", lambda: same("usage", {
    "account_id": [7, 8, 9], "api_calls": [12000, None, 5], "storage_gb": [1.5, None, None]}))
check("single-column extract with missing scores", lambda: same("nps", {
    "score": [9, None, 7, 10, None, None, 3]}))
check("single-column extract starting with a missing score", lambda: same("nps", {
    "score": [None, 8, 6]}))
check("single-column extract without missing values", lambda: same("nps", {"score": [10, 0, 5]}))


def t_header():
    path = os.path.join(tempfile.mkdtemp(prefix="extract-"), "h.csv")
    save_extract(build_extract("nps", {"score": [1]}), path)
    with open(path, encoding="utf-8") as fh:
        first = fh.readline().strip()
    return first.strip('"') == "score", f"first line = {first!r}"


check("written file has a header row", t_header)
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
