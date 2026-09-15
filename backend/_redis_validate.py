"""Ad-hoc validation harness for the Redis L2 cache + distributed lock layer.

Exercises cache_service directly against whatever REDIS_URL is configured
(env or settings). Prints a compact PASS/FAIL report. Safe to delete.
"""
import os
import time
import services.cache_service as cache_svc


def main() -> None:
    print("=== Redis cache layer validation ===")
    print("status:", cache_svc.status())
    enabled = cache_svc.is_enabled()
    print("is_enabled:", enabled)

    # 1) JSON cache-aside roundtrip + TTL
    key = "validate:json"
    cache_svc.delete(key)
    wrote = cache_svc.set_json(key, {"hello": "world", "n": 42}, ttl_seconds=120)
    got = cache_svc.get_json(key)
    print(f"set_json={wrote} get_json={got}")

    # 2) Distributed lock dedup: two acquires of the same lock
    lock = "validate:lock"
    cache_svc.release_lock(lock, cache_svc.acquire_lock(lock, ttl_seconds=2))  # clear any stale
    t1 = cache_svc.acquire_lock(lock, ttl_seconds=30)
    t2 = cache_svc.acquire_lock(lock, ttl_seconds=30)
    print(f"lock_first={t1!r} lock_second={t2!r}")
    if enabled:
        dedup_ok = (t1 not in (None, "LOCAL")) and (t2 is None)
        print("DEDUP:", "PASS (second acquire blocked)" if dedup_ok else "FAIL")
    else:
        print("DEDUP: N/A (Redis disabled -> LOCAL sentinel, in-process guard governs)")
    # release and prove re-acquire works
    cache_svc.release_lock(lock, t1)
    t3 = cache_svc.acquire_lock(lock, ttl_seconds=5)
    print(f"lock_after_release={t3!r}")
    cache_svc.release_lock(lock, t3)

    # 3) List app keys currently in Redis
    if enabled:
        try:
            client = cache_svc._client_or_none()
            keys = sorted(client.keys("*")) if client else []
            print(f"redis_keys ({len(keys)}):")
            for k in keys[:50]:
                ttl = client.ttl(k)
                print(f"  {k}  ttl={ttl}s")
        except Exception as e:
            print("keys listing error:", e)

    cache_svc.delete(key)
    print("=== done ===")


if __name__ == "__main__":
    main()
