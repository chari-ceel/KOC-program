from pymongo import MongoClient
import os

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
PERSONA_DB_NAME = os.getenv("PERSONA_DB_NAME", "koc_agent_persona")
TREND_DB_NAME = os.getenv("TREND_DB_NAME", "koc_agent_trend")
CONTENT_DB_NAME = os.getenv("CONTENT_DB_NAME", "koc_agent_content")
MEMORY_DB_NAME = os.getenv("MEMORY_DB_NAME", "koc_agent_memory")

client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
persona_db = client[PERSONA_DB_NAME]
trend_db = client[TREND_DB_NAME]
content_db = client[CONTENT_DB_NAME]
memory_db = client[MEMORY_DB_NAME]
