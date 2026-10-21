"""Feature preprocessing for the churn model."""
import pandas as pd
from sklearn.impute import SimpleImputer

NUMERIC = ["tenure_months", "monthly_spend"]
CATEGORICAL = ["plan", "region"]  # pandas `category` dtype


class NumericImputer:
    """Fills missing NUMERIC values with the training median."""

    def fit(self, train):
        self.imputer_ = SimpleImputer(strategy="median").set_output(transform="pandas").fit(train[NUMERIC])
        return self

    def transform(self, df):
        return self.imputer_.transform(df[NUMERIC])


class CategoryImputer:
    """Fills missing CATEGORICAL values with the most frequent training value."""

    def fit(self, train):
        self.imputer_ = SimpleImputer(strategy="most_frequent").set_output(transform="pandas").fit(train[CATEGORICAL])
        return self

    def transform(self, df):
        return self.imputer_.transform(df[CATEGORICAL])


def preprocess(train, df):
    """Impute ``df`` with statistics learned on ``train``; returns the NUMERIC + CATEGORICAL columns."""
    num = NumericImputer().fit(train)
    cat = CategoryImputer().fit(train)
    return pd.concat([num.transform(df), cat.transform(df)], axis=1)
