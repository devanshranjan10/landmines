# Hidden test for pandas-61223. Run from the task's working directory.
import io, math, os, sys, warnings
sys.path.insert(0, os.getcwd())
warnings.simplefilter("ignore")
import pandas as pd
from app.tickets import load_board, set_owner, set_status, set_tags

fail = 0
total = 0


def check(cond, msg):
    global fail, total
    total += 1
    if not cond:
        fail += 1
        print("FAIL", msg)


CSV = "id,title,status,owner\n101,Login fails,open,ana\n102,Slow search,open,\n103,Typo in footer,done,raj\n"


def untagged(v):
    return v is None or (isinstance(v, float) and math.isnan(v)) or v is pd.NA or (isinstance(v, list) and v == [])


def tags_of(board, tid):
    return board.at[tid, "tags"] if "tags" in board.columns else None


def run(label, fn):
    try:
        fn()
        return True
    except Exception as e:  # noqa: BLE001
        check(False, f"{label}: raised {type(e).__name__}: {e}")
        return False


# existing helpers
b = load_board(io.StringIO(CSV))
set_status(b, 102, "in-progress")
set_owner(b, 102, "lee")
check(b.at[102, "status"] == "in-progress" and b.at[102, "owner"] == "lee", "set_status/set_owner broken")

# board that already has a tags column
b = load_board(io.StringIO(CSV))
b["tags"] = pd.Series([["ui"], None, None], index=b.index, dtype=object)
if run("existing tags column", lambda: set_tags(b, 102, ["perf", "search"])):
    check(list(tags_of(b, 102)) == ["perf", "search"], f"existing tags column: 102 -> {tags_of(b, 102)!r}")
    check(list(tags_of(b, 101)) == ["ui"], f"existing tags column: 101 -> {tags_of(b, 101)!r}")

# fresh board: first time anything is tagged
b = load_board(io.StringIO(CSV))
if run("fresh board, two tags", lambda: set_tags(b, 101, ["bug", "auth"])):
    check(list(tags_of(b, 101)) == ["bug", "auth"], f"fresh board: 101 -> {tags_of(b, 101)!r}")
    check(untagged(tags_of(b, 102)) and untagged(tags_of(b, 103)), f"fresh board: untagged rows -> {tags_of(b, 102)!r}, {tags_of(b, 103)!r}")
if run("fresh board, more tags", lambda: (set_tags(b, 103, ("docs",)), set_tags(b, 101, ["bug"]))):
    check(list(tags_of(b, 103)) == ["docs"], f"fresh board: 103 -> {tags_of(b, 103)!r}")
    check(list(tags_of(b, 101)) == ["bug"], f"fresh board: 101 after retag -> {tags_of(b, 101)!r}")
    check(b.at[101, "title"] == "Login fails" and b.at[103, "status"] == "done", "fresh board: other columns changed")

# fresh board: single tag first
b = load_board(io.StringIO(CSV))
if run("fresh board, one tag", lambda: set_tags(b, 102, ["perf"])):
    check(list(tags_of(b, 102)) == ["perf"], f"one tag: 102 -> {tags_of(b, 102)!r}")
    check(untagged(tags_of(b, 101)) and untagged(tags_of(b, 103)), f"one tag: untagged rows -> {tags_of(b, 101)!r}, {tags_of(b, 103)!r}")

print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
