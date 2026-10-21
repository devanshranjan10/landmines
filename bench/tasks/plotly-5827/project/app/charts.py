"""Figures for the sales dashboard.

Input frames come from the monthly sales extract and have one row per store and month:

    month     str   "YYYY-MM"
    region    str   e.g. "North"
    channel   str   "retail" | "online" | "wholesale"
    store_id  int   numeric store number, e.g. 12
    revenue   float
"""
import pandas as pd
import plotly.graph_objects as go

TEMPLATE = "plotly_white"


def monthly_totals(df: pd.DataFrame) -> go.Figure:
    """Bar chart of total revenue per month."""
    totals = df.groupby("month", sort=True)["revenue"].sum()
    fig = go.Figure(go.Bar(x=totals.index.tolist(), y=totals.tolist(), name="Revenue"))
    fig.update_layout(template=TEMPLATE, title="Monthly revenue", yaxis_title="Revenue")
    return fig


def revenue_by(df: pd.DataFrame, column: str) -> go.Figure:
    """Line chart of monthly revenue, one line per distinct value of `column`."""
    raise NotImplementedError
