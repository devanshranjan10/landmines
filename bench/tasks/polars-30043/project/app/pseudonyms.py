"""Pseudonymised user index.

Raw email addresses never leave the ingestion host. Everything downstream works with ``email_key``, a
64-bit hash of the normalised address (trimmed, lower-cased), computed by :func:`email_key`.

The index is a single Parquet file with columns

    email_key  UInt64   hash of the normalised email (unique per user)
    user_id    Int64
    region     String   e.g. "eu-west"
    created    Date     sign-up date

sorted by ``email_key``. It is rebuilt nightly from the users table with :func:`build_index`.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

import polars as pl

HASH_SEED = 20240611
# Lookups and region scans read whole row groups; keep them moderately sized.
ROW_GROUP_SIZE = 200_000

INDEX_SCHEMA = pl.Schema({
    "email_key": pl.UInt64,
    "user_id": pl.Int64,
    "region": pl.String,
    "created": pl.Date,
})


def email_key(email: pl.Expr) -> pl.Expr:
    """Pseudonymous key of an email address column/expression."""
    return email.str.strip_chars().str.to_lowercase().hash(seed=HASH_SEED)


def build_index(users: pl.DataFrame, path: str | Path) -> None:
    """Write the index for a users table with columns email, user_id, region, created."""
    (
        users.select(email_key(pl.col("email")).alias("email_key"), "user_id", "region", "created")
        .cast(dict(INDEX_SCHEMA))
        .sort("email_key")
        .write_parquet(path, row_group_size=ROW_GROUP_SIZE)
    )


def users_in_region(path: str | Path, region: str) -> pl.DataFrame:
    """All index rows of one region."""
    return pl.scan_parquet(path).filter(pl.col("region") == region).collect()


def signups_between(path: str | Path, start: date, end: date) -> int:
    """Number of users who signed up in [start, end]."""
    return (
        pl.scan_parquet(path)
        .filter(pl.col("created").is_between(start, end))
        .select(pl.len())
        .collect()
        .item()
    )


def lookup(path: str | Path, email: str) -> dict | None:
    """Index row (email_key, user_id, region, created) of the user with this email, or None."""
    raise NotImplementedError
