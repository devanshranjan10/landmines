"""Loading of the deployctl YAML config."""
import sys
from pathlib import Path

import yaml

DEFAULTS = {
    "region": "eu-west-1",
    "replicas": 1,
    "timeout_s": 30,
    "feature_mask": 0,
}


class ConfigError(Exception):
    """The config can't be used. The message is shown to the user as-is."""


def load_config(text: str, source: str = "<config>") -> dict:
    raise NotImplementedError


def load_config_file(path: str | Path) -> dict:
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise ConfigError(f"{path}: cannot read config ({e.strerror})") from e
    return load_config(text, source=str(path))


def main(argv: list[str]) -> int:
    try:
        cfg = load_config_file(argv[1] if len(argv) > 1 else "deploy.yaml")
    except ConfigError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    for key, value in sorted(cfg.items()):
        print(f"{key} = {value!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
