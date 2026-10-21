"""Card-fraud detector based on a nu-SVM. Labels: 1 = fraud, 0 = legit."""
import numpy as np
from sklearn.svm import NuSVC

NU = 0.1  # tuned on the 2024 backtest


def train_detector(X, y, fraud_weight=10.0):
    """Fit and return the fraud detector on features ``X`` and labels ``y``."""
    model = NuSVC(nu=NU, class_weight={0: 1.0, 1: fraud_weight})
    return model.fit(X, y)


def flag(model, X):
    """Boolean array, True where ``model`` flags a transaction as fraud."""
    return np.asarray(model.predict(X)) == 1
