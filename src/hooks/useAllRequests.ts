// 拉取并缓存"全量请求记录"，供 Sessions / Models / Trends 页客户端聚合
//
// 后端 getRecentRequests(N) 已经返回完整 RequestRecord（含 source / sessionId
// / model / tokens 等），我们一次拉一个大数（默认 50000），三个页面共用同一份。
// 监听 onDataChanged 后增量重拉。
//
// 后续如果记录量真的大到 50000 条以上，再请 Codex 加分页 / 过滤接口（已在
// HANDOFF_FOR_CODEX.md 列出）。
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { RequestRecord } from '@/types/api'

const FETCH_LIMIT = 50_000

interface CacheEntry {
  data: RequestRecord[] | null
  loading: boolean
  error: unknown
  fetchedAt: number
}

const cache: CacheEntry = {
  data: null,
  loading: false,
  error: null,
  fetchedAt: 0,
}

const subscribers = new Set<() => void>()
const notify = () => subscribers.forEach((s) => s())

let inflight: Promise<void> | null = null

async function load(force = false) {
  if (cache.data && !force) return
  if (inflight) return inflight
  cache.loading = true
  cache.error = null
  notify()
  inflight = api
    .getRecentRequests(FETCH_LIMIT)
    .then((records) => {
      cache.data = records
      cache.fetchedAt = Date.now()
    })
    .catch((err) => {
      cache.error = err
    })
    .finally(() => {
      cache.loading = false
      inflight = null
      notify()
    })
  return inflight
}

let unsubFromIPC: (() => void) | null = null

function ensureIPCListener() {
  if (unsubFromIPC) return
  unsubFromIPC = api.onDataChanged(() => {
    void load(true)
  })
}

export function useAllRequests() {
  const [, setTick] = useState(0)

  useEffect(() => {
    ensureIPCListener()
    const sub = () => setTick((n) => n + 1)
    subscribers.add(sub)
    void load()
    return () => {
      subscribers.delete(sub)
    }
  }, [])

  return {
    data: cache.data,
    loading: cache.loading,
    error: cache.error,
    refresh: () => load(true),
  }
}
