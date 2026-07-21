// 拉取并缓存"全量请求记录"，供 Sessions / Models / Trends 页客户端聚合
//
// 后端 getRecentRequests(N) 已经返回完整 RequestRecord（含 source / sessionId
// / model / tokens 等）。这里用于“全部”类页面，所以请求完整扫描结果，三个页面共用同一份。
// 监听 onDataChanged 后增量重拉。
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { filterRecordsByUsageScope } from '@/lib/usage-scope'
import { useUsageScope } from '@/stores/usage-scope'
import type { RequestRecord } from '@/types/api'

const FETCH_LIMIT = Number.MAX_SAFE_INTEGER

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

export function useScopedRequests() {
  const query = useAllRequests()
  const scope = useUsageScope((state) => state.scope)
  const data = useMemo(
    () => (query.data ? filterRecordsByUsageScope(query.data, scope) : null),
    [query.data, scope],
  )

  return {
    ...query,
    data,
    scope,
  }
}
