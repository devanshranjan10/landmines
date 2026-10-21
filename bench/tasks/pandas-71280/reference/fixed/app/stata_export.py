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
    out = df[["week", "region", "orders", "revenue"]].copy()
    # Stata week index within the year: 0..51, the last week absorbing Dec 30/31.
    week_no = ((out["week"].dt.dayofyear - 1) // 7).clip(upper=51)
    year_start = pd.to_datetime(out["week"].dt.year.astype(str) + "-01-01")
    out["week"] = year_start + pd.to_timedelta(week_no * 7, unit="D")
    out.to_stata(path, convert_dates={"week": "tw"}, write_index=False)
