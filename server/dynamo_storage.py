"""
DynamoDB storage backend.

Wraps the existing db.py helpers to implement the StorageBackend interface.
"""

import json
from datetime import datetime, timezone
from typing import List, Optional

from db import get_table
from storage import StorageBackend


def _serialize_geojson(geojson: list) -> str:
    """Serialize layout list to a JSON string for DynamoDB storage."""
    return json.dumps(geojson)


def _deserialize_geojson(geojson_str) -> list:
    """Deserialize layout string from DynamoDB back to list."""
    if isinstance(geojson_str, list):
        return geojson_str
    return json.loads(geojson_str)


class DynamoStorage(StorageBackend):
    """Stores plots in an AWS DynamoDB table."""

    def list_plots(self) -> List[dict]:
        table = get_table()
        response = table.scan(
            ProjectionExpression="id, #n, shapeCount, createdAt, updatedAt",
            ExpressionAttributeNames={"#n": "name"},
        )
        items = response.get("Items", [])

        while "LastEvaluatedKey" in response:
            response = table.scan(
                ProjectionExpression="id, #n, shapeCount, createdAt, updatedAt",
                ExpressionAttributeNames={"#n": "name"},
                ExclusiveStartKey=response["LastEvaluatedKey"],
            )
            items.extend(response.get("Items", []))

        items.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)
        return items

    def get_plot(self, plot_id: str) -> Optional[dict]:
        table = get_table()
        response = table.get_item(Key={"id": plot_id})
        item = response.get("Item")
        if not item:
            return None
        item["geojson"] = _deserialize_geojson(item["geojson"])
        return item

    def create_plot(self, item: dict) -> dict:
        table = get_table()
        # Serialize geojson for DynamoDB storage
        stored = {**item, "geojson": _serialize_geojson(item["geojson"])}
        table.put_item(Item=stored)
        return item  # return with list (not string) geojson

    def update_plot(self, plot_id: str, updates: dict) -> Optional[dict]:
        table = get_table()

        existing = table.get_item(Key={"id": plot_id})
        if "Item" not in existing:
            return None

        now = datetime.now(timezone.utc).isoformat()

        update_expr_parts = ["#updatedAt = :updatedAt"]
        attr_names = {"#updatedAt": "updatedAt"}
        attr_values = {":updatedAt": now}

        if "name" in updates and updates["name"] is not None:
            update_expr_parts.append("#n = :name")
            attr_names["#n"] = "name"
            attr_values[":name"] = updates["name"]

        if "geojson" in updates and updates["geojson"] is not None:
            update_expr_parts.append("geojson = :geojson")
            attr_values[":geojson"] = _serialize_geojson(updates["geojson"])

        table.update_item(
            Key={"id": plot_id},
            UpdateExpression="SET " + ", ".join(update_expr_parts),
            ExpressionAttributeNames=attr_names,
            ExpressionAttributeValues=attr_values,
        )

        updated = table.get_item(Key={"id": plot_id})["Item"]
        updated["geojson"] = _deserialize_geojson(updated["geojson"])
        return updated

    def delete_plot(self, plot_id: str) -> bool:
        table = get_table()
        existing = table.get_item(Key={"id": plot_id})
        if "Item" not in existing:
            return False
        table.delete_item(Key={"id": plot_id})
        return True
