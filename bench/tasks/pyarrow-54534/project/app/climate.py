"""Long-running weather station records.

Each station's observations are kept in a table whose ``observed_at`` column is a timestamp in the station's own
time zone, so the local reading time is what people see when they inspect the data.
"""
from __future__ import annotations

from datetime import datetime

import pyarrow as pa
import pyarrow.parquet as pq

STATIONS = {
    "NYC": ("New York Central Park", "America/New_York"),
    "DUB": ("Dublin Phoenix Park", "Europe/Dublin"),
}


def station_schema(station: str) -> pa.Schema:
    _, tz = STATIONS[station]
    return pa.schema([
        ("observed_at", pa.timestamp("s", tz=tz)),
        ("tmax_c", pa.float64()),
        ("tmin_c", pa.float64()),
        ("precip_mm", pa.float64()),
    ])


def observations(station: str, rows: list[tuple[datetime, float, float, float]]) -> pa.Table:
    """Build a station table from (aware datetime, tmax_c, tmin_c, precip_mm) tuples."""
    observed_at, tmax, tmin, precip = (list(col) for col in zip(*rows)) if rows else ([], [], [], [])
    return pa.table([observed_at, tmax, tmin, precip], schema=station_schema(station))


def save_station(table: pa.Table, path: str) -> None:
    pq.write_table(table, path)


def load_station(path: str, station: str) -> pa.Table:
    return pq.read_table(path, schema=station_schema(station))


def export_csv(table: pa.Table, path: str) -> None:
    """Write a station table as CSV for the climate portal."""
    raise NotImplementedError
