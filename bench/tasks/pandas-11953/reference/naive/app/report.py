"""Customer report rendering."""
import pandas as pd

REPORT_COLUMNS = ["name", "email", "signed_up", "last_order", "lifetime_value"]


def load_customers(path) -> pd.DataFrame:
    """Customer export from the CRM (CSV)."""
    return pd.read_csv(path, parse_dates=["signed_up", "last_order"])


def blank_missing(df: pd.DataFrame) -> pd.DataFrame:
    """Copy of `df` with every missing value replaced by an empty string."""
    return df.fillna("")


def render_html(df: pd.DataFrame) -> str:
    """HTML table for the weekly customer report."""
    return blank_missing(df[REPORT_COLUMNS]).to_html(index=False)
