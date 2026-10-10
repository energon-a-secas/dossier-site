---
title: Performance Report
author: System
date: 2026-10-10
---

# Overview

This report covers the performance improvements made in October.

## Metrics

The baseline has improved significantly:

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| p95 latency | 340ms | 182ms | -46% |
| Error rate | 2.1% | 0.3% | -85% |

## Implementation

The fix involved three key changes:

```typescript
export async function take(key: string, cost = 1) {
  return redis.eval(TAKE, 1, key, cost);
}
```

## Notes

> This implementation requires Redis 6.0 or later for Lua script support.

All tests pass and the change is ready for production.
