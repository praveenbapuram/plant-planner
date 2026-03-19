import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException

from models import PlotCreate, PlotUpdate, PlotResponse, PlotSummary
from storage import get_storage

router = APIRouter(prefix="/api/plots", tags=["plots"])


@router.get("/", response_model=List[PlotSummary])
def list_plots():
    """List all saved plots (summary only, no GeoJSON body)."""
    storage = get_storage()
    return storage.list_plots()


@router.get("/{plot_id}", response_model=PlotResponse)
def get_plot(plot_id: str):
    """Get a specific plot with its full GeoJSON."""
    storage = get_storage()
    item = storage.get_plot(plot_id)
    if not item:
        raise HTTPException(status_code=404, detail="Plot not found")
    return item


@router.post("/", response_model=PlotResponse, status_code=201)
def create_plot(plot: PlotCreate):
    """Create a new plot layout."""
    storage = get_storage()
    now = datetime.now(timezone.utc).isoformat()

    item = {
        "id": str(uuid.uuid4()),
        "name": plot.name,
        "geojson": plot.geojson,
        "createdAt": now,
        "updatedAt": now,
    }

    return storage.create_plot(item)


@router.put("/{plot_id}", response_model=PlotResponse)
def update_plot(plot_id: str, plot: PlotUpdate):
    """Update an existing plot layout."""
    storage = get_storage()

    updates = {}
    if plot.name is not None:
        updates["name"] = plot.name
    if plot.geojson is not None:
        updates["geojson"] = plot.geojson

    result = storage.update_plot(plot_id, updates)
    if result is None:
        raise HTTPException(status_code=404, detail="Plot not found")
    return result


@router.delete("/{plot_id}")
def delete_plot(plot_id: str):
    """Delete a plot layout."""
    storage = get_storage()
    deleted = storage.delete_plot(plot_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Plot not found")
    return {"message": "Plot deleted successfully"}
