"""Publish fitted model coefficients for the pricing service."""
import pandas as pd

COLUMNS = ["feature", "weight", "bias"]


def load_coefficients(path) -> pd.DataFrame:
    """Coefficients table produced by the nightly fit (one row per feature)."""
    df = pd.read_csv(path)
    return df[COLUMNS]


def coefficients_payload(df: pd.DataFrame) -> str:
    """JSON text for the pricing service: an array with one object per row."""
    return df.to_json(orient="records")
