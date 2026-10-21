"""Nightly metric extracts.

Each extract is a small table of numeric metrics, one row per account, in account order. Missing metrics are null.
The schemas below are the contract with the finance team.
"""
from __future__ import annotations

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as csv

EXTRACT_SCHEMAS: dict[str, pa.Schema] = {
    "revenue": pa.schema([
        ("account_id", pa.int64()),
        ("mrr", pa.float64()),
        ("seats", pa.int64()),
    ]),
    "usage": pa.schema([
        ("account_id", pa.int64()),
        ("api_calls", pa.int64()),
        ("storage_gb", pa.float64()),
    ]),
    # Positional: row i belongs to the i-th account of the nightly account list.
    "nps": pa.schema([
        ("score", pa.int64()),
    ]),
}


def build_extract(name: str, columns: dict[str, list]) -> pa.Table:
    """Build an extract table from Python lists, validated against its registered schema."""
    return pa.table(columns, schema=EXTRACT_SCHEMAS[name])


def summary(table: pa.Table) -> dict[str, dict[str, float | int | None]]:
    """Per-column count of present values and their mean, for the nightly report."""
    out = {}
    for name in table.column_names:
        col = table[name]
        out[name] = {"present": len(col) - col.null_count, "mean": pc.mean(col).as_py()}
    return out


def save_extract(table: pa.Table, path: str) -> None:
    """Write an extract to ``path`` as CSV with a header row."""
    csv.write_csv(table, path)


def load_extract(path: str, name: str) -> pa.Table:
    """Read an extract written by ``save_extract`` back with the schema registered for ``name``."""
    schema = EXTRACT_SCHEMAS[name]
    table = csv.read_csv(
        path,
        convert_options=csv.ConvertOptions(column_types=schema, include_columns=schema.names),
    )
    return table.cast(schema)
