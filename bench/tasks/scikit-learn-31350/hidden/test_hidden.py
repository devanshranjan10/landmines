# Hidden test for scikit-learn-31350. Run from the task's working directory.
import os
import sys
import warnings

sys.path.insert(0, os.getcwd())
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd

from app.prep import CATEGORICAL, NUMERIC, CategoryImputer, preprocess

PLAN = pd.CategoricalDtype(["basic", "pro", "team"])
REGION = pd.CategoricalDtype(["eu", "us", "apac"])

train = pd.DataFrame(
    {
        "tenure_months": [1.0, 5.0, np.nan, 9.0, 12.0],
        "monthly_spend": [10.0, np.nan, 30.0, 40.0, 50.0],
        "plan": pd.Series(["basic", "pro", "pro", None, "pro"], dtype=PLAN),
        "region": pd.Series(["eu", "us", None, "eu", "eu"], dtype=REGION),
    }
)
new = pd.DataFrame(
    {
        "tenure_months": [np.nan, 3.0, 4.0],
        "monthly_spend": [20.0, np.nan, 25.0],
        "plan": pd.Series([None, "basic", "team"], dtype=PLAN),
        "region": pd.Series(["us", None, None], dtype=REGION),
    }
).set_axis([10, 11, 12])

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


def case_values():
    out = CategoryImputer().fit(train).transform(new)
    got = {c: list(out[c]) for c in CATEGORICAL}
    want = {"plan": ["pro", "basic", "team"], "region": ["us", "eu", "eu"]}
    return got == want and list(out.index) == [10, 11, 12], f"got {got} index={list(out.index)}, want {want} index=[10, 11, 12]"


def case_dtype():
    out = CategoryImputer().fit(train).transform(new)
    got = {c: str(out[c].dtype) for c in CATEGORICAL}
    ok = all(isinstance(out[c].dtype, pd.CategoricalDtype) for c in CATEGORICAL)
    return ok, f"dtypes {got}, want category"


def case_categories():
    out = CategoryImputer().fit(train).transform(new)
    got = {c: list(out[c].cat.categories) for c in CATEGORICAL}
    want = {"plan": ["basic", "pro", "team"], "region": ["eu", "us", "apac"]}
    return got == want, f"got {got}, want {want}"


def case_train_itself():
    out = CategoryImputer().fit(train).transform(train)
    got = {c: list(out[c]) for c in CATEGORICAL}
    want = {"plan": ["basic", "pro", "pro", "pro", "pro"], "region": ["eu", "us", "eu", "eu", "eu"]}
    return got == want, f"got {got}, want {want}"


def case_preprocess():
    out = preprocess(train, new)
    ok = (
        list(out.columns) == NUMERIC + CATEGORICAL
        and out["tenure_months"].tolist() == [7.0, 3.0, 4.0]
        and out["monthly_spend"].tolist() == [20.0, 35.0, 25.0]
        and isinstance(out["plan"].dtype, pd.CategoricalDtype)
        and out["plan"].cat.codes.tolist() == [1, 0, 2]
        and out["region"].cat.codes.tolist() == [1, 0, 0]
    )
    return ok, f"got\n{out}\n{out.dtypes.to_dict()}"


for name, fn in [
    ("fills with training mode", case_values),
    ("keeps categorical dtype", case_dtype),
    ("keeps categories", case_categories),
    ("transform on training frame", case_train_itself),
    ("preprocess end to end", case_preprocess),
]:
    check(name, fn)

print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
