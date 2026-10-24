"""Gemini client, a per-model rate limiter, and a retry helper that respects the API's retry hints."""
import asyncio
import re
import time
from functools import lru_cache

from .config import settings


@lru_cache(maxsize=1)
def gemini():
    """Return a google-genai client, or None when no key is set."""
    if not settings.has_gemini:
        return None
    from google import genai
    return genai.Client(api_key=settings.gemini_api_key)


class RateLimiter:
    """Spaces out calls so we stay under a requests-per-minute limit."""

    def __init__(self, rpm: int):
        self.gap = 60.0 / max(1, rpm)
        self.next_at = 0.0
        self.lock = asyncio.Lock()

    async def wait(self):
        async with self.lock:
            now = time.monotonic()
            if self.next_at > now:
                await asyncio.sleep(self.next_at - now)
            self.next_at = max(now, self.next_at) + self.gap


_limiters: dict[str, RateLimiter] = {}


def limiter(key: str, rpm: int) -> RateLimiter:
    if key not in _limiters:
        _limiters[key] = RateLimiter(rpm)
    return _limiters[key]


RETRYABLE = (429, 500, 502, 503, 504)


def _status(e: Exception):
    code = getattr(e, "code", None) or getattr(e, "status_code", None)
    if isinstance(code, int):
        return code
    msg = str(e)
    if "RESOURCE_EXHAUSTED" in msg:
        return 429
    for c in RETRYABLE:
        if str(c) in msg[:40]:
            return c
    return None


def _retry_hint(e: Exception) -> float | None:
    m = re.search(r"retryDelay'?\"?:\s*'?\"?(\d+(?:\.\d+)?)s", str(e))
    return float(m.group(1)) if m else None


async def with_retry(make_call, model: str | None = None, tries: int = 5):
    """Wait for the model's rate limit, then call. Retry rate-limit and server errors."""
    lim = limiter("gemini:" + (model or "default"), settings.gemini_rpm)
    for i in range(tries):
        await lim.wait()
        try:
            return await make_call()
        except Exception as e:  # noqa: BLE001
            if i < tries - 1 and _status(e) in RETRYABLE:
                await asyncio.sleep((_retry_hint(e) or 2 ** (i + 1)) + 1)
                continue
            raise


def friendly_error(e: Exception) -> str:
    code = _status(e)
    if code == 429:
        return "The model's free-tier limit was hit. Wait a minute, or switch to the demo agent."
    if code in (401, 403) or "API key" in str(e):
        return "The Gemini API key was rejected. Check GEMINI_API_KEY in your .env file."
    if code == 404 or "not found" in str(e).lower():
        return "That Gemini model id wasn't found. Check AGENT_MODEL and JUDGE_MODEL in .env against AI Studio."
    return f"Model call failed: {str(e)[:200]}"