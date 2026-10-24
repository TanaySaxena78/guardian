"""Tests run offline: ignore any real API keys in .env so results are fast and repeatable."""
import os

os.environ["GEMINI_API_KEY"] = ""
os.environ["GROQ_API_KEY"] = ""
os.environ["GEMINI_RPM"] = "6000"
os.environ["GROQ_RPM"] = "6000"