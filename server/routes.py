import json
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from db import get_table
from models import PlotCreate, PlotUpdate, PlotResponse, PlotSummary

router = APIRouter(prefix="/api/plots", tags=["plots"])


def _serialize_geojson(geojson: list) -> str:
    """Serialize layout list to a JSON string for DynamoDB storage."""
    return json.dumps(geojson)


def _deserialize_geojson(geojson_str: str) -> list:
    """Deserialize layout string from DynamoDB back to list."""
    if isinstance(geojson_str, list):
        return geojson_str
    return json.loads(geojson_str)


@router.get("/", response_model=List[PlotSummary])
def list_plots():
    """List all saved plots (summary only, no GeoJSON body)."""
    table = get_table()
    response = table.scan(
        ProjectionExpression="id, #n, createdAt, updatedAt",
        ExpressionAttributeNames={"#n": "name"},
    )
    items = response.get("Items", [])

    # Handle pagination for large datasets
    while "LastEvaluatedKey" in response:
        response = table.scan(
            ProjectionExpression="id, #n, createdAt, updatedAt",
            ExpressionAttributeNames={"#n": "name"},
            ExclusiveStartKey=response["LastEvaluatedKey"],
        )
        items.extend(response.get("Items", []))

    # Sort by updatedAt descending (most recent first)
    items.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)
    return items


@router.get("/{plot_id}", response_model=PlotResponse)
def get_plot(plot_id: str):
    """Get a specific plot with its full GeoJSON."""
    table = get_table()
    response = table.get_item(Key={"id": plot_id})
    item = response.get("Item")

    if not item:
        raise HTTPException(status_code=404, detail="Plot not found")

    item["geojson"] = _deserialize_geojson(item["geojson"])
    return item


@router.post("/", response_model=PlotResponse, status_code=201)
def create_plot(plot: PlotCreate):
    """Create a new plot layout."""
    table = get_table()
    now = datetime.now(timezone.utc).isoformat()

    item = {
        "id": str(uuid.uuid4()),
        "name": plot.name,
        "geojson": _serialize_geojson(plot.geojson),
        "createdAt": now,
        "updatedAt": now,
    }

    table.put_item(Item=item)

    item["geojson"] = plot.geojson
    return item


@router.put("/{plot_id}", response_model=PlotResponse)
def update_plot(plot_id: str, plot: PlotUpdate):
    """Update an existing plot layout."""
    table = get_table()

    # Verify plot exists
    existing = table.get_item(Key={"id": plot_id})
    if "Item" not in existing:
        raise HTTPException(status_code=404, detail="Plot not found")

    now = datetime.now(timezone.utc).isoformat()

    update_expr_parts = ["#updatedAt = :updatedAt"]
    attr_names = {"#updatedAt": "updatedAt"}
    attr_values = {":updatedAt": now}

    if plot.name is not None:
        update_expr_parts.append("#n = :name")
        attr_names["#n"] = "name"
        attr_values[":name"] = plot.name

    if plot.geojson is not None:
        update_expr_parts.append("geojson = :geojson")
        attr_values[":geojson"] = _serialize_geojson(plot.geojson)

    table.update_item(
        Key={"id": plot_id},
        UpdateExpression="SET " + ", ".join(update_expr_parts),
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=attr_values,
    )

    # Fetch and return the updated item
    updated = table.get_item(Key={"id": plot_id})["Item"]
    updated["geojson"] = _deserialize_geojson(updated["geojson"])
    return updated


@router.delete("/{plot_id}")
def delete_plot(plot_id: str):
    """Delete a plot layout."""
    table = get_table()

    # Verify plot exists
    existing = table.get_item(Key={"id": plot_id})
    if "Item" not in existing:
        raise HTTPException(status_code=404, detail="Plot not found")

    table.delete_item(Key={"id": plot_id})
    return {"message": "Plot deleted successfully"}
