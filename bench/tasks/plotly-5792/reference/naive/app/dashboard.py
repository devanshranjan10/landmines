"""Plotly figures for the order-operations dashboard."""
from dataclasses import dataclass

import plotly.graph_objects as go
from plotly.subplots import make_subplots


@dataclass
class OrderStats:
    days: list[str]  # ISO dates
    orders_per_day: list[int]
    by_channel: dict[str, int]
    by_region: dict[str, int]


def comparison_figure(left: OrderStats, right: OrderStats, labels: tuple[str, str]) -> go.Figure:
    """Two order trends side by side (e.g. this week vs last week)."""
    fig = make_subplots(rows=1, cols=2, subplot_titles=list(labels), shared_yaxes=True)
    fig.add_trace(go.Scatter(x=left.days, y=left.orders_per_day, mode="lines", name=labels[0]), row=1, col=1)
    fig.add_trace(go.Scatter(x=right.days, y=right.orders_per_day, mode="lines", name=labels[1]), row=1, col=2)
    fig.update_layout(template="plotly_white", showlegend=False)
    return fig


def overview_figure(stats: OrderStats) -> go.Figure:
    """Single-page overview: daily trend on top, channel and region breakdown below."""
    fig = make_subplots(
        rows=2,
        cols=2,
        specs=[[{"colspan": 2}, None], [{}, {}]],
        row_titles=["Trend", "Breakdown"],
    )
    fig.add_trace(go.Scatter(x=stats.days, y=stats.orders_per_day, mode="lines", name="Orders"), row=1, col=1)
    fig.add_trace(go.Bar(x=list(stats.by_channel), y=list(stats.by_channel.values()), name="Channel"), row=2, col=1)
    fig.add_trace(go.Bar(x=list(stats.by_region), y=list(stats.by_region.values()), name="Region"), row=2, col=2)
    fig.update_layout(template="plotly_white", showlegend=False)
    return fig
