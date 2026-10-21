"""Expense reports exported from the corporate card portal.

A report is a CSV with the columns employee, category, merchant, amount. Like the rest of our reporting
code, reports are loaded with Arrow-backed dtypes.
"""
import pandas as pd


def load_report(source) -> pd.DataFrame:
    """Read an expense report CSV (path or file-like object)."""
    return pd.read_csv(source, dtype_backend="pyarrow")


def employees(report: pd.DataFrame) -> list[str]:
    """Distinct employees in the report, sorted."""
    return sorted(report["employee"].dropna().unique().tolist())


def merchants_by_category(report: pd.DataFrame) -> dict[str, list[str]]:
    """Distinct merchants per category, sorted."""
    grouped = report.dropna(subset=["category", "merchant"]).groupby("category")["merchant"]
    return {cat: sorted(vals.unique().tolist()) for cat, vals in grouped}


def clean_amounts(report: pd.DataFrame) -> pd.DataFrame:
    """Copy of the report with a numeric `amount` column (invalid amounts become missing)."""
    out = report.copy()
    out["amount"] = pd.to_numeric(out["amount"], errors="coerce")
    return out


def amount_summary(report: pd.DataFrame) -> dict:
    """Total of the valid amounts and the number of rows without a valid amount."""
    amounts = clean_amounts(report)["amount"]
    return {"total": float(amounts.sum()), "invalid_rows": int(amounts.isna().sum())}
