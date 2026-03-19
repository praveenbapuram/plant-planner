"""
Local file-system storage backend.

Each plot is stored as an individual JSON file inside LOCAL_STORAGE_DIR.
File name: <plot_id>.json
"""

import json
import os
from datetime import datetime, timezone
from typing import List, Optional

from config import LOCAL_STORAGE_DIR
from storage import StorageBackend


class LocalStorage(StorageBackend):
    """Stores plots as individual JSON files on the local filesystem."""

    def __init__(self):
        os.makedirs(LOCAL_STORAGE_DIR, exist_ok=True)

    # ---- helpers -------------------------------------------------------

    def _file_path(self, plot_id: str) -> str:
        return os.path.join(LOCAL_STORAGE_DIR, f"{plot_id}.json")

    def _read_file(self, plot_id: str) -> Optional[dict]:
        path = self._file_path(plot_id)
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _write_file(self, plot_id: str, data: dict) -> None:
        path = self._file_path(plot_id)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    # ---- interface -----------------------------------------------------

    def list_plots(self) -> List[dict]:
        """Return summaries of all plots (no geojson)."""
        items = []
        for fname in os.listdir(LOCAL_STORAGE_DIR):
            if not fname.endswith(".json"):
                continue
            path = os.path.join(LOCAL_STORAGE_DIR, fname)
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            items.append({
                "id": data["id"],
                "name": data["name"],
                "createdAt": data["createdAt"],
                "updatedAt": data["updatedAt"],
            })
        # Most recently updated first
        items.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)
        return items

    def get_plot(self, plot_id: str) -> Optional[dict]:
        """Return a full plot including geojson."""
        data = self._read_file(plot_id)
        if data is None:
            return None
        # Ensure geojson is deserialized
        if isinstance(data.get("geojson"), str):
            data["geojson"] = json.loads(data["geojson"])
        return data

    def create_plot(self, item: dict) -> dict:
        """Persist a new plot."""
        self._write_file(item["id"], item)
        return item

    def update_plot(self, plot_id: str, updates: dict) -> Optional[dict]:
        """Merge updates into an existing plot and persist."""
        data = self._read_file(plot_id)
        if data is None:
            return None

        for key, value in updates.items():
            data[key] = value
        data["updatedAt"] = datetime.now(timezone.utc).isoformat()

        self._write_file(plot_id, data)

        # Ensure geojson comes back as a list
        if isinstance(data.get("geojson"), str):
            data["geojson"] = json.loads(data["geojson"])
        return data

    def delete_plot(self, plot_id: str) -> bool:
        """Remove the JSON file for a plot."""
        path = self._file_path(plot_id)
        if not os.path.exists(path):
            return False
        os.remove(path)
        return True
