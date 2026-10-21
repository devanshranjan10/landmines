# Hidden test for polars-30043. Run from the task's working directory.
import os
import sys
import tempfile
from datetime import date, timedelta

sys.path.insert(0, os.getcwd())
import polars as pl  # noqa: E402

from app.pseudonyms import build_index, email_key, lookup, users_in_region  # noqa: E402

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


REGIONS = ["eu-west", "eu-central", "us-east", "us-west", "ap-south"]
D0 = date(2019, 1, 1)


def users_table(n):
    i = pl.int_range(0, n, eager=True)
    return pl.DataFrame({
        "email": ("user" + i.cast(pl.String) + "@example.com"),
        "user_id": i + 100_000,
        "region": i.map_elements(lambda k: REGIONS[k % len(REGIONS)], return_dtype=pl.String),
        "created": i.map_elements(lambda k: D0 + timedelta(days=k % 2500), return_dtype=pl.Date),
    })


def expected(k):
    return {"user_id": k + 100_000, "region": REGIONS[k % len(REGIONS)], "created": D0 + timedelta(days=k % 2500)}


def same(row, k):
    if row is None:
        return False
    exp = expected(k)
    return all(row.get(c) == v for c, v in exp.items())


tmp = tempfile.mkdtemp()

# Small index: ordinary behaviour.
SMALL = os.path.join(tmp, "small.parquet")
build_index(users_table(50), SMALL)

# Production-sized index (~500k users).
N = 500_000
BIG = os.path.join(tmp, "big.parquet")
build_index(users_table(N), BIG)


def t_small_lookup():
    bad = [k for k in range(50) if not same(lookup(SMALL, f"user{k}@example.com"), k)]
    return not bad, f"wrong/missing rows for users {bad}"


def t_unknown():
    r1 = lookup(SMALL, "nobody@example.com")
    r2 = lookup(BIG, "nobody@example.com")
    return r1 is None and r2 is None, f"got {r1!r} / {r2!r}"


def t_normalised():
    row = lookup(SMALL, "  User7@Example.COM ")
    return same(row, 7), f"got {row!r}"


def t_key_column():
    row = lookup(SMALL, "user3@example.com")
    key = pl.select(email_key(pl.lit("user3@example.com"))).item()
    return row is not None and row.get("email_key") == key, f"got {row!r}, expected email_key {key}"


def t_big_index():
    sample = list(range(0, N, 4999)) + [N - 1]
    bad = [k for k in sample if not same(lookup(BIG, f"user{k}@example.com"), k)]
    return not bad, f"{len(bad)}/{len(sample)} users not found or wrong in the {N}-user index, e.g. {bad[:5]}"


def t_existing_export():
    df = users_in_region(SMALL, "us-east")
    return sorted(df["user_id"].to_list()) == [100_000 + k for k in range(50) if k % 5 == 2], "users_in_region changed"


check("lookup in a small index", t_small_lookup)
check("unknown email returns None", t_unknown)
check("email is normalised before hashing", t_normalised)
check("row includes email_key", t_key_column)
check("lookup across a production-sized index", t_big_index)
check("users_in_region still works", t_existing_export)
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
