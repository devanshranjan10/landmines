"""Helpdesk reporting on the vendor's nightly ticket export.

Export format (one file per night): UTF-8 CSV, comma separated, header row, fields quoted when they contain a comma,
quote or line break (quotes doubled), CRLF line endings. Columns, in order:

    ticket_id    e.g. "T-000123"
    opened       ISO date, e.g. 2026-05-01
    customer     customer e-mail
    subject      one line
    description  free text from the customer, may span several lines
"""
from __future__ import annotations

import pyarrow as pa
import pyarrow.compute as pc

TICKET_SCHEMA = pa.schema([
    ("ticket_id", pa.string()),
    ("opened", pa.date32()),
    ("customer", pa.string()),
    ("subject", pa.string()),
    ("description", pa.string()),
])


def load_tickets(path: str) -> pa.Table:
    """Read one export file into a Table with exactly TICKET_SCHEMA."""
    raise NotImplementedError


def tickets_per_day(tickets: pa.Table) -> dict:
    """Number of tickets opened per day."""
    grouped = tickets.group_by("opened").aggregate([("ticket_id", "count")])
    return dict(zip(grouped["opened"].to_pylist(), grouped["ticket_id_count"].to_pylist()))


def tickets_for(tickets: pa.Table, customer: str) -> pa.Table:
    """All tickets of one customer, in export order."""
    return tickets.filter(pc.equal(tickets["customer"], customer))
