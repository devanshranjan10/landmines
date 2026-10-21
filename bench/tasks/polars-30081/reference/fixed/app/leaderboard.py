"""Leaderboard queries for the coding contest.

Submissions are appended to one Parquet file per contest with columns

    submission_id  Int64
    team           String
    score          Float64   0-100, higher is better
    tests_passed   Int64
    submitted_at   Datetime  UTC, microseconds; unique per submission

Queries take the LazyFrame returned by :func:`load_submissions` so they can be combined before collecting.
"""
from __future__ import annotations

from pathlib import Path

import polars as pl

COLUMNS = ["submission_id", "team", "score", "tests_passed", "submitted_at"]


def load_submissions(path: str | Path) -> pl.LazyFrame:
    return pl.scan_parquet(path).select(COLUMNS)


def team_best(lf: pl.LazyFrame) -> pl.DataFrame:
    """Best score of each team with the number of submissions, best team first (ties by team name)."""
    return (
        lf.group_by("team")
        .agg(pl.col("score").max().alias("best_score"), pl.len().alias("submissions"))
        .sort(["best_score", "team"], descending=[True, False])
        .collect()
    )


def submissions_of(lf: pl.LazyFrame, team: str) -> pl.DataFrame:
    """All submissions of one team, oldest first."""
    return lf.filter(pl.col("team") == team).sort("submitted_at").collect()


def top_entries(lf: pl.LazyFrame, by: str, n: int = 10) -> pl.DataFrame:
    """The n submissions with the highest value in column `by`, ties broken by the earlier submitted_at."""
    keys = [by] if by == "submitted_at" else [by, "submitted_at"]
    return (
        lf.sort(keys, descending=[True] + [False] * (len(keys) - 1))
        .head(n)
        .collect()
    )
