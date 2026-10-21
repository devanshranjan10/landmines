"""Inventory events and the JSON-lines audit log."""
from datetime import datetime

from pydantic import BaseModel


class Event(BaseModel):
    id: str
    at: datetime


class PriceChanged(Event):
    sku: str
    old_price: float
    new_price: float
    discount: float = 0


class StockAdjusted(Event):
    sku: str
    delta: int
    reason: str = "count"


class AuditEntry(BaseModel):
    actor: str
    event: Event


def to_log_line(entry: AuditEntry) -> str:
    """One line of the audit log."""
    return entry.model_dump_json()


def from_log_line(line: str) -> AuditEntry:
    """Read a line of the audit log back."""
    raise NotImplementedError
