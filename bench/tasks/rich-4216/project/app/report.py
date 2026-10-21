"""Nightly batch-run reports, rendered with Rich."""
from dataclasses import dataclass, field

from rich.console import Group
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

WIDTH = 60


@dataclass
class Job:
    name: str
    status: str  # "ok" | "failed" | "skipped"
    seconds: float


@dataclass
class Run:
    title: str
    jobs: list[Job] = field(default_factory=list)


def heading(title: str) -> Text:
    """Section heading in the house style: bold and centered."""
    return Text(title, style="bold", justify="center")


def summary_card(run: Run) -> Panel:
    """Card shown in the terminal UI."""
    table = Table.grid(padding=(0, 2))
    table.add_column()
    table.add_column(justify="right")
    for job in run.jobs:
        table.add_row(job.name, job.status)
    return Panel(Group(heading(run.title), table), width=WIDTH)


def render_report(run: Run) -> str:
    """Plain-text report for the e-mailed summary."""
    raise NotImplementedError
