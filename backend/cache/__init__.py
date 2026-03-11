from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

try:
    import redis.asyncio as redis
except ImportError:  # pragma: no cover - optional dependency at import time
    redis = None


class CacheStore:
    def __init__(self, redis_url: str | None = None) -> None:
        self.redis_url = (redis_url or os.getenv("REDIS_URL", "")).strip()
        self._memory: dict[str, tuple[float | None, str]] = {}
        self._lock = asyncio.Lock()
        self._redis = None

        if self.redis_url and redis is not None:
            self._redis = redis.from_url(self.redis_url, decode_responses=True)

    async def get_json(self, key: str) -> Any | None:
        if self._redis is not None:
            try:
                value = await self._redis.get(key)
                return json.loads(value) if value is not None else None
            except Exception:
                pass

        async with self._lock:
            entry = self._memory.get(key)
            if not entry:
                return None
            expires_at, raw_value = entry
            if expires_at is not None and expires_at < time.time():
                self._memory.pop(key, None)
                return None
            return json.loads(raw_value)

    async def set_json(self, key: str, value: Any, ttl_seconds: int | None = None) -> None:
        encoded = json.dumps(value)
        if self._redis is not None:
            try:
                if ttl_seconds:
                    await self._redis.set(key, encoded, ex=ttl_seconds)
                else:
                    await self._redis.set(key, encoded)
                return
            except Exception:
                pass

        expires_at = time.time() + ttl_seconds if ttl_seconds else None
        async with self._lock:
            self._memory[key] = (expires_at, encoded)

    async def delete(self, key: str) -> None:
        if self._redis is not None:
            try:
                await self._redis.delete(key)
            except Exception:
                pass
        async with self._lock:
            self._memory.pop(key, None)

    async def append_recent(self, key: str, value: Any, limit: int = 10) -> list[Any]:
        current = await self.get_json(key) or []
        current = [item for item in current if item != value]
        current.insert(0, value)
        current = current[:limit]
        await self.set_json(key, current)
        return current


_cache_store: CacheStore | None = None


def get_cache() -> CacheStore:
    global _cache_store
    if _cache_store is None:
        _cache_store = CacheStore()
    return _cache_store
