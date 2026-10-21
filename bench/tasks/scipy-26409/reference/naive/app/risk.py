"""Failure-risk estimates for replicated placement groups.

Each node of a placement group fails independently within the risk window (one repair interval) with
its own probability, taken from the fleet's failure-rate model. The number of nodes failing in the same
window therefore follows a Poisson-binomial distribution (``scipy.stats.poisson_binom``).
"""
import numpy as np
from scipy import stats


def expected_failures(p_fail):
    """Expected number of nodes of the group failing in the same window."""
    return float(stats.poisson_binom.mean(np.asarray(p_fail, dtype=float)))


def failure_count_variance(p_fail):
    """Variance of the number of nodes failing in the same window."""
    return float(stats.poisson_binom.var(np.asarray(p_fail, dtype=float)))


def loss_probability(p_fail, tolerated):
    """Probability that more than ``tolerated`` nodes of the group fail in the same window."""
    p = np.asarray(p_fail, dtype=float)
    return float(stats.poisson_binom.sf(tolerated, p))


def durability_nines(p_fail, tolerated):
    """Durability of the group per window, in nines: ``-log10(loss_probability)``."""
    return float(-np.log10(loss_probability(p_fail, tolerated)))
