"""Settings, read from environment variables or a .env file."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent

# Look for .env in the project root first, then in backend/
load_dotenv(ROOT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env")


def _float(name: str, default: str) -> float:
    return float(os.getenv(name, default))


def _int(name: str, default: str) -> int:
    return int(os.getenv(name, default))


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "").strip()
    groq_api_key: str = os.getenv("GROQ_API_KEY", "").strip()

    # Check the exact model ids in Google AI Studio before you run.
    agent_model: str = os.getenv("AGENT_MODEL", "gemini-3.8-flash")
    judge_model: str = os.getenv("JUDGE_MODEL", "gemini-3.5-flash-lite")
    rules_model: str = os.getenv("RULES_MODEL", "gemini-3.5-flash-lite")
    prompt_guard_model: str = os.getenv("PROMPT_GUARD_MODEL", "meta-llama/llama-prompt-guard-2-22m")
    prompt_guard_threshold: float = _float("PROMPT_GUARD_THRESHOLD", "0.5")

    # Free-tier rate limits (requests per minute). Raise these if you're on a paid tier.
    gemini_rpm: int = _int("GEMINI_RPM", "12")
    groq_rpm: int = _int("GROQ_RPM", "25")

    max_agent_turns: int = _int("MAX_AGENT_TURNS", "30")
    approval_timeout_s: int = _int("APPROVAL_TIMEOUT_S", "900")
    runs_per_ip_per_hour: int = _int("RUNS_PER_IP_PER_HOUR", "15")
    allowed_origins: str = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
    static_dir: str = os.getenv("STATIC_DIR", str(ROOT_DIR / "frontend" / "dist"))
    data_dir: str = os.getenv("DATA_DIR", str(BACKEND_DIR / "data"))

    @property
    def has_gemini(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def has_groq(self) -> bool:
        return bool(self.groq_api_key)


settings = Settings()
Path(settings.data_dir).mkdir(parents=True, exist_ok=True)