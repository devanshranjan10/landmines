"""Daily inventory snapshots from the warehouse feed."""
import pandas as pd

COLUMNS = ["price", "qty", "location"]


def load_snapshot(path) -> pd.DataFrame:
    """One snapshot CSV (sku,price,qty,location), indexed by sku."""
    return pd.read_csv(path, index_col="sku")[COLUMNS]


def fill_from_previous(today: pd.DataFrame, previous: pd.DataFrame) -> pd.DataFrame:
    """Today's snapshot with gaps filled from the previous snapshot."""
    raise NotImplementedError


def stock_value(snapshot: pd.DataFrame) -> pd.Series:
    """Value on hand per sku, in currency units rounded to cents."""
    return (snapshot["price"] * snapshot["qty"]).round(2)
