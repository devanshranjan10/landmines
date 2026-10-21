"""KPI exports for the economics team, who work in Stata.

Daily KPIs: day, region, orders, revenue (one row per region and calendar day).
Weekly KPIs: week, region, orders, revenue, where `week` is the Monday that starts our reporting week.
"""
import pandas as pd


def load_daily(source) -> pd.DataFrame:
    return pd.read_csv(source, parse_dates=["day"])


def load_weekly(source) -> pd.DataFrame:
    return pd.read_csv(source, parse_dates=["week"])


def export_daily(df: pd.DataFrame, path) -> None:
    """Write daily KPIs to a Stata .dta file with `day` as a Stata daily date (%td)."""
    df[["day", "region", "orders", "revenue"]].to_stata(path, convert_dates={"day": "td"}, write_index=False)


def export_weekly(df: pd.DataFrame, path) -> None:
    """Write weekly KPIs to a Stata .dta file with `week` as a Stata weekly date (%tw)."""
    out = df[["week", "region", "orders", "revenue"]]
    out.to_stata(path, convert_dates={"week": "tw"}, write_index=False)
