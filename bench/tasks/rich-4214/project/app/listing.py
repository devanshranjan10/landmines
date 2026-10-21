"""Console output for the `ls`-style commands of the export CLI."""
from rich.columns import Columns
from rich.console import Console
from rich.text import Text

# Width of one column in file listings, so grids from different sections line up.
COLUMN_WIDTH = 24


def print_tags(console: Console, tags: list[str]) -> None:
    """Tags are short; let Rich pack them as tightly as it can."""
    console.print(Columns([Text(tag, style="cyan") for tag in tags], equal=True))


def print_listing(console: Console, names: list[str]) -> None:
    """Print export file names as a grid of fixed-width columns."""
    raise NotImplementedError
