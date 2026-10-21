"""Card-fraud detector based on a nu-SVM. Labels: 1 = fraud, 0 = legit."""
import numpy as np
from sklearn.svm import NuSVC

NU = 0.1  # tuned on the 2024 backtest


def train_detector(X, y, fraud_weight=10.0):
    """Fit and return the fraud detector on features ``X`` and labels ``y``."""
    # NuSVC ignores class_weight, so express the per-class cost as per-sample weights.
    y = np.asarray(y)
    sample_weight = np.where(y == 1, float(fraud_weight), 1.0)
    return NuSVC(nu=NU).fit(X, y, sample_weight=sample_weight)


def flag(model, X):
    """Boolean array, True where ``model`` flags a transaction as fraud."""
    return np.asarray(model.predict(X)) == 1
