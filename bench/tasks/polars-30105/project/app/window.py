"""Recent sign-in events for the live security dashboard.

The collector pushes small batches of events (oldest first) into an ``EventWindow``; the dashboard reads
aggregates from it every few seconds. Event columns:

    event_id  Int64     monotonically increasing id assigned by the collector
    ts        Datetime  event time (UTC, microseconds)
    user      String    account name
    success   Boolean   whether the sign-in succeeded
    reviewed  Boolean   analyst verdict on the event: true = confirmed legit, false = confirmed malicious,
                        null = not reviewed yet
"""
from __future__ import annotations

import polars as pl

SCHEMA = pl.Schema({
    "event_id": pl.Int64,
    "ts": pl.Datetime("us"),
    "user": pl.String,
    "success": pl.Boolean,
    "reviewed": pl.Boolean,
})


def _normalize(batch: pl.DataFrame) -> pl.DataFrame:
    """Select the window's columns, in order, with the window's dtypes."""
    return batch.select(list(SCHEMA)).cast(dict(SCHEMA))


class EventWindow:
    """The most recent events, oldest first."""

    def __init__(self, max_rows: int = 50_000) -> None:
        self.max_rows = max_rows
        self._frame = pl.DataFrame(schema=SCHEMA)

    def append(self, batch: pl.DataFrame) -> None:
        """Add a batch of new events (oldest first) to the end of the window."""
        self._frame.extend(_normalize(batch))

    def __len__(self) -> int:
        return self._frame.height

    def frame(self) -> pl.DataFrame:
        """A copy of the window's events, oldest first."""
        return self._frame.clone()

    def failure_rate(self) -> float:
        """Share of events in the window whose sign-in failed (0.0 for an empty window)."""
        if self._frame.is_empty():
            return 0.0
        return float(self._frame.select((~pl.col("success")).mean()).item())

    def pending_review(self) -> pl.DataFrame:
        """Failed sign-ins that no analyst has reviewed yet, oldest first."""
        return self._frame.filter(~pl.col("success") & pl.col("reviewed").is_null())
