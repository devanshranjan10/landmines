"""Fiscal reporting helpers.

Our fiscal year starts on 1 March. Fiscal quarters start on 1 March, 1 June, 1 September and
1 December; fiscal half-years start on 1 March (H1) and 1 September (H2).
Inputs are daily revenue series indexed by date.
"""
import pandas as pd


def monthly_totals(daily: pd.Series) -> pd.Series:
    """Revenue per calendar month, labelled by the first day of the month."""
    return daily.resample("MS").sum()


def quarterly_totals(daily: pd.Series) -> pd.Series:
    """Revenue per fiscal quarter, labelled by the quarter's start date."""
    return daily.resample("QS-MAR").sum()


def half_year_totals(daily: pd.Series) -> pd.Series:
    """Revenue per fiscal half-year, labelled by the half's start date."""
    idx = daily.index
    month = idx.month
    start_month = [3 if 3 <= m < 9 else 9 for m in month]
    start_year = [y - 1 if m < 3 else y for y, m in zip(idx.year, month)]
    key = pd.to_datetime(pd.DataFrame({"year": start_year, "month": start_month, "day": 1}))
    totals = daily.groupby(key.to_numpy()).sum()
    totals.index = pd.DatetimeIndex(totals.index)
    return totals.sort_index()
