import os
from dotenv import load_dotenv

load_dotenv()

AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
AWS_PROFILE = os.getenv("AWS_PROFILE")

DYNAMODB_TABLE_NAME = os.getenv("DYNAMODB_TABLE_NAME", "plant_planner")
DYNAMODB_LOCAL = os.getenv("DYNAMODB_LOCAL", "false").lower() == "true"
DYNAMODB_LOCAL_ENDPOINT = os.getenv("DYNAMODB_LOCAL_ENDPOINT", "http://localhost:8000")

PORT = int(os.getenv("PORT", "3001"))
