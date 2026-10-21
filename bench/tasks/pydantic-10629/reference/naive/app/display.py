"""Display settings for the kiosk player."""
from enum import Enum
from pathlib import Path

from pydantic import BaseModel


class Resolution(Enum):
    HD = (1280, 720)
    FULL_HD = (1920, 1080)
    QHD = (2560, 1440)
    UHD = (3840, 2160)

    @property
    def width(self) -> int:
        return self.value[0]

    @property
    def height(self) -> int:
        return self.value[1]


class DisplaySettings(BaseModel):
    resolution: Resolution = Resolution.FULL_HD
    refresh_hz: int = 60
    brightness: float = 0.8
    rotate_180: bool = False


def mode_line(settings: DisplaySettings) -> str:
    """e.g. "1920x1080@60" for the player's --mode flag."""
    r = settings.resolution
    return f"{r.width}x{r.height}@{settings.refresh_hz}"


def save_settings(settings: DisplaySettings, path: Path) -> None:
    """Persist settings as JSON."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(settings.model_dump_json(indent=2), encoding="utf-8")


def load_settings(path: Path) -> DisplaySettings:
    """Settings saved by save_settings, or the defaults if nothing was saved yet."""
    path = Path(path)
    if not path.exists():
        return DisplaySettings()
    return DisplaySettings.model_validate_json(path.read_text(encoding="utf-8"))
