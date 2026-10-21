"""In-memory ledger for the month-end close.

Entries live in a DataFrame with the columns account (str), amount (float) and qty (int), one row per
entry, indexed 0..n-1. The archiver that stores closed periods consumes pyarrow tables.
"""
import pandas as pd
import pyarrow as pa

COLUMNS = ["account", "amount", "qty"]


class Ledger:
    def __init__(self, df: pd.DataFrame):
        self.df = df

    @classmethod
    def from_records(cls, records: list[dict]) -> "Ledger":
        """Build a ledger from dicts with the keys account, amount and qty."""
        df = pd.DataFrame.from_records(records, columns=COLUMNS)
        return cls(df.astype({"amount": "float64", "qty": "int64"}))

    def correct_amount(self, row: int, amount: float) -> None:
        """Overwrite the amount of one entry."""
        self.df.loc[row, "amount"] = amount

    def adjust_qty(self, row: int, delta: int) -> None:
        """Add `delta` to the quantity of one entry."""
        self.df.loc[row, "qty"] += delta

    def balance(self) -> float:
        return float(self.df["amount"].sum())

    def snapshot(self) -> pa.Table:
        """The current entries as a pyarrow Table."""
        return pa.Table.from_pandas(self.df, preserve_index=False)
