import boto3
import json
from botocore.exceptions import ClientError
from config import (
    AWS_REGION,
    AWS_PROFILE,
    DYNAMODB_TABLE_NAME,
    DYNAMODB_LOCAL,
    DYNAMODB_LOCAL_ENDPOINT,
)


def get_dynamodb_resource():
    """Create and return a DynamoDB resource."""
    kwargs = {
        "region_name": AWS_REGION,
    }

    if DYNAMODB_LOCAL:
        kwargs["endpoint_url"] = DYNAMODB_LOCAL_ENDPOINT
        kwargs["aws_access_key_id"] = "local"
        kwargs["aws_secret_access_key"] = "local"
        return boto3.resource("dynamodb", **kwargs)
    else:
        session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
        return session.resource("dynamodb")

    return boto3.resource("dynamodb", **kwargs)


def get_table():
    """Get the DynamoDB table, creating it if it doesn't exist."""
    dynamodb = get_dynamodb_resource()

    try:
        table = dynamodb.Table(DYNAMODB_TABLE_NAME)
        table.load()
        return table
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceNotFoundException":
            return create_table(dynamodb)
        raise


def create_table(dynamodb):
    """Create the plots table in DynamoDB."""
    table = dynamodb.create_table(
        TableName=DYNAMODB_TABLE_NAME,
        KeySchema=[
            {"AttributeName": "id", "KeyType": "HASH"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "id", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    table.wait_until_exists()
    print(f"✅ Created DynamoDB table: {DYNAMODB_TABLE_NAME}")
    return table
