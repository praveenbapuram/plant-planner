from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime


class PlotCreate(BaseModel):
    """Request model for creating a new plot."""
    name: str = Field(..., min_length=1, max_length=200, description="Name of the plot layout")
    geojson: list = Field(..., description="Array of shape configuration objects")


class PlotUpdate(BaseModel):
    """Request model for updating an existing plot."""
    name: Optional[str] = Field(None, min_length=1, max_length=200, description="Updated name")
    geojson: Optional[list] = Field(None, description="Updated Array of shapes")


class PlotResponse(BaseModel):
    """Response model for a full plot."""
    id: str
    name: str
    geojson: list
    createdAt: str
    updatedAt: str


class PlotSummary(BaseModel):
    """Response model for plot list (no geojson body)."""
    id: str
    name: str
    shapeCount: int = 0
    createdAt: str
    updatedAt: str
