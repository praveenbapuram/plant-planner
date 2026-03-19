"""
Storage abstraction layer.

Provides a unified interface for plot CRUD operations.
The actual backend (local JSON files or DynamoDB) is selected
based on the STORAGE_TYPE environment variable.
"""

from abc import ABC, abstractmethod
from typing import List, Optional


class StorageBackend(ABC):
    """Abstract base class for storage backends."""

    @abstractmethod
    def list_plots(self) -> List[dict]:
        """Return all plots as summary dicts (no geojson body)."""
        ...

    @abstractmethod
    def get_plot(self, plot_id: str) -> Optional[dict]:
        """Return a single plot with full geojson, or None if not found."""
        ...

    @abstractmethod
    def create_plot(self, item: dict) -> dict:
        """Persist a new plot item and return it."""
        ...

    @abstractmethod
    def update_plot(self, plot_id: str, updates: dict) -> Optional[dict]:
        """Apply partial updates to an existing plot. Return updated item or None."""
        ...

    @abstractmethod
    def delete_plot(self, plot_id: str) -> bool:
        """Delete a plot. Return True if it existed, False otherwise."""
        ...


def get_storage() -> StorageBackend:
    """Factory: return the correct storage backend based on configuration."""
    from config import STORAGE_TYPE

    if STORAGE_TYPE == "local":
        from local_storage import LocalStorage
        return LocalStorage()
    elif STORAGE_TYPE == "dynamodb":
        from dynamo_storage import DynamoStorage
        return DynamoStorage()
    else:
        raise ValueError(
            f"Unknown STORAGE_TYPE: '{STORAGE_TYPE}'. "
            "Must be 'local' or 'dynamodb'."
        )
