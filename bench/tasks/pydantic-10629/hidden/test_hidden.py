# Hidden test for pydantic-10629. Run from the task's working directory.
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.getcwd())
from app.display import DisplaySettings, Resolution, load_settings, mode_line, save_settings  # noqa: E402

fail = 0
total = 0
TMP = Path(tempfile.mkdtemp(prefix="hidden-display-"))


def check(name, fn):
    global fail, total
    total += 1
    try:
        ok, detail = fn()
    except Exception as e:  # noqa: BLE001
        ok, detail = False, f"raised {type(e).__name__}: {str(e).splitlines()[:3]}"
    if not ok:
        fail += 1
        print(f"FAIL {name}: {detail}")


def t_missing():
    s = load_settings(TMP / "nope" / "display.json")
    return s == DisplaySettings(), f"got {s!r}"


def t_roundtrip(settings, name):
    def run():
        p = TMP / f"{name}.json"
        save_settings(settings, p)
        back = load_settings(p)
        ok = isinstance(back, DisplaySettings) and back == settings and back.resolution is settings.resolution
        return ok, f"saved {settings!r}, loaded {back!r}"
    return run


def t_is_json():
    p = TMP / "plain.json"
    save_settings(DisplaySettings(resolution=Resolution.QHD, refresh_hz=144), p)
    data = json.loads(p.read_text(encoding="utf-8"))
    return isinstance(data, dict) and data.get("refresh_hz") == 144, f"file content {data!r}"


def t_mode_line_after_load():
    p = TMP / "mode.json"
    save_settings(DisplaySettings(resolution=Resolution.HD, refresh_hz=50), p)
    got = mode_line(load_settings(p))
    return got == "1280x720@50", f"got {got!r}"


def t_overwrite():
    p = TMP / "over.json"
    save_settings(DisplaySettings(resolution=Resolution.UHD), p)
    save_settings(DisplaySettings(brightness=0.25), p)
    back = load_settings(p)
    return back == DisplaySettings(brightness=0.25), f"got {back!r}"


check("missing file gives defaults", t_missing)
check("round trip defaults", t_roundtrip(DisplaySettings(), "defaults"))
check("round trip UHD rotated", t_roundtrip(DisplaySettings(resolution=Resolution.UHD, refresh_hz=30, brightness=1.0, rotate_180=True), "uhd"))
check("round trip HD", t_roundtrip(DisplaySettings(resolution=Resolution.HD, brightness=0.5), "hd"))
check("file is plain JSON", t_is_json)
check("mode_line after load", t_mode_line_after_load)
check("save overwrites", t_overwrite)
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
