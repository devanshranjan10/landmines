# Hidden test for pandas-62072. Run from the task's working directory.
import io, json, os, sys
sys.path.insert(0, os.getcwd())
import pandas as pd
from app.export import coefficients_payload, load_coefficients

fail = 0
total = 0


def check(cond, msg):
    global fail, total
    total += 1
    if not cond:
        fail += 1
        print("FAIL", msg)


def roundtrip(df, label):
    try:
        text = coefficients_payload(df)
        got = json.loads(text)
    except Exception as e:  # noqa: BLE001
        check(False, f"{label}: raised {type(e).__name__}: {e}")
        return
    want = df.to_dict(orient="records")
    check(isinstance(got, list) and len(got) == len(want), f"{label}: expected list of {len(want)} records, got {text[:200]}")
    if not isinstance(got, list):
        return
    for i, (g, w) in enumerate(zip(got, want)):
        check(g == w, f"{label}: record {i} = {g}, want {w}")


# ordinary: short decimals
roundtrip(pd.DataFrame({"feature": ["age", "tenure"], "weight": [0.25, -1.5], "bias": [0.0, 2.0]}), "short decimals")

# fitted coefficients with full double precision
csv = (
    "feature,weight,bias\n"
    "age,0.2617993877991494,-0.11111111111111112\n"
    "tenure,1234.5678901234567,0.30000000000000004\n"
    "region_north,-3.141592653589793e-05,7.0\n"
    "basket,0.1,0.2\n"
)
roundtrip(load_coefficients(io.StringIO(csv)), "fitted coefficients")

print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
