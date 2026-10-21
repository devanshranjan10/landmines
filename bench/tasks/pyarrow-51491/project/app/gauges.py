"""Rain-gauge archive.

Each day's readings are stored as one Parquet file, ``<root>/<YYYY-MM-DD>.parquet``, with columns:

    station  string     gauge identifier, e.g. "G-014"
    ts       timestamp  reading time (UTC, second resolution)
    mm       float64    rainfall in millimetres since the previous reading; NaN when the sample failed
"""
from __future__ import annotations

import os
from datetime import date

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.parquet as pq

SCHEMA = pa.schema([
    ("station", pa.string()),
    ("ts", pa.timestamp("s")),
    ("mm", pa.float64()),
])


def write_day(root: str, day: date, table: pa.Table) -> str:
    """Write one day's readings to the archive and return the file path."""
    os.makedirs(root, exist_ok=True)
    path = os.path.join(root, f"{day.isoformat()}.parquet")
    pq.write_table(table.cast(SCHEMA), path)
    return path


def archive(root: str) -> ds.Dataset:
    return ds.dataset(root, format="parquet", schema=SCHEMA)


def readings_for_station(root: str, station: str) -> pa.Table:
    """All readings of one gauge, oldest first."""
    table = archive(root).to_table(filter=pc.field("station") == station)
    return table.sort_by([("ts", "ascending")])


def stations(root: str) -> list[str]:
    """Distinct gauge identifiers present in the archive, sorted."""
    table = archive(root).to_table(columns=["station"])
    return sorted(pc.unique(table["station"]).to_pylist())


def readings_for_review(root: str) -> pa.Table:
    """Readings the QA team must review: everything whose mm is not exactly 0.0, sorted by station, ts."""
    raise NotImplementedError
