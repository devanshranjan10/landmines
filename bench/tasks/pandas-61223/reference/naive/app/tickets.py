"""In-memory ticket board backed by a DataFrame indexed by ticket id."""
import pandas as pd


def load_board(path) -> pd.DataFrame:
    """Ticket export (id,title,status,owner), indexed by ticket id."""
    return pd.read_csv(path, index_col="id")


def set_status(board: pd.DataFrame, ticket_id, status: str) -> None:
    """Move a ticket to another status (in place)."""
    board.at[ticket_id, "status"] = status


def set_owner(board: pd.DataFrame, ticket_id, owner: str) -> None:
    """Assign a ticket (in place)."""
    board.at[ticket_id, "owner"] = owner


def set_tags(board: pd.DataFrame, ticket_id, tags) -> None:
    """Replace a ticket's labels (in place)."""
    board.at[ticket_id, "tags"] = list(tags)
