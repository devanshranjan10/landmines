"""Customer satisfaction scores from the survey vendor.

The vendor's JSON export is {"responses": [{"customer": ..., "region": ..., "score": ...}, ...]}. A score is
a number from 0 to 100, or the string "n/a" when the customer skipped the question.
"""
import json

import numpy as np
import pandas as pd


def load_scores(raw: str | bytes) -> pd.DataFrame:
    """Parse a vendor export into a DataFrame (customer, region, score); skipped scores become NaN."""
    df = pd.DataFrame(json.loads(raw)["responses"], columns=["customer", "region", "score"])
    df["score"] = df["score"].replace("n/a", np.nan)
    return df


def skipped(df: pd.DataFrame) -> int:
    """Number of responses without a score."""
    return int(df["score"].isna().sum())


def mean_by_region(df: pd.DataFrame) -> dict[str, float]:
    """Average score per region, ignoring skipped scores."""
    return {region: float(v) for region, v in df.groupby("region")["score"].mean().items()}


def score_bands(df: pd.DataFrame) -> pd.Series:
    """NPS-style band for each response."""
    raise NotImplementedError


def band_counts(df: pd.DataFrame) -> dict[str, int]:
    """Number of responses per band."""
    raise NotImplementedError
