"""Per-channel statistics for sensor exports.

Samples that the logger failed to record arrive as NaN (or +/-inf on overflow) and are
masked out before computing statistics.
"""
import numpy as np


def as_masked(samples) -> np.ma.MaskedArray:
    """Samples as a float masked array with invalid readings masked."""
    return np.ma.masked_invalid(np.asarray(samples, dtype=float))


def channel_mean(samples) -> float:
    return float(np.mean(as_masked(samples)))


def channel_std(samples) -> float:
    return float(np.std(as_masked(samples)))


def channel_span(samples) -> float:
    """Peak-to-peak span of the valid samples."""
    return float(np.ptp(as_masked(samples)))


def channel_summary(samples) -> dict:
    return {
        "mean": channel_mean(samples),
        "std": channel_std(samples),
        "span": channel_span(samples),
    }
