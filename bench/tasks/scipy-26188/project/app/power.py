"""Power analysis for one-way ANOVA experiments (k groups of n subjects each).

Effect sizes are Cohen's f. Under the alternative, the ANOVA F statistic follows a noncentral F
distribution with noncentrality ``lambda = f**2 * k * n`` (Cohen's convention).
"""
import numpy as np
from scipy import stats

ALPHA = 0.05


def degrees_of_freedom(k_groups, n_per_group):
    """(numerator, denominator) degrees of freedom of the one-way ANOVA F test."""
    return k_groups - 1, k_groups * (n_per_group - 1)


def critical_f(k_groups, n_per_group, alpha=ALPHA):
    """F value above which the test rejects the null hypothesis at level ``alpha``."""
    dfn, dfd = degrees_of_freedom(k_groups, n_per_group)
    return stats.f.isf(alpha, dfn, dfd)


def power(effect_f, k_groups, n_per_group, alpha=ALPHA):
    """Probability that the test rejects at level ``alpha`` when the true effect size is ``effect_f``."""
    raise NotImplementedError


def min_group_size(effect_f, k_groups, target=0.8, alpha=ALPHA, max_n=10_000):
    """Smallest n per group whose power reaches ``target``."""
    raise NotImplementedError
