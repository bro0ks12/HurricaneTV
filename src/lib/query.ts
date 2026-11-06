import { useEffect, useRef, useState } from "react";

const cache = new Map<string, { data: unknown; at: number }>();
const inflight = new Map<string, Promise<unknown>>();
const TTL = 15 * 60_000;

export function clearCache() {
  cache.clear();
  inflight.clear();
}

export function fetchCached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data as T);
  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn()
      .then((d) => {
        cache.set(key, { data: d, at: Date.now() });
        return d;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

export function useQuery<T>(key: string | null, fn: () => Promise<T>) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>(() => {
    const hit = key ? cache.get(key) : undefined;
    return hit ? { data: hit.data as T, loading: false } : { loading: !!key };
  });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!key) {
      setState({ loading: false });
      return;
    }
    let alive = true;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) {
      setState({ data: hit.data as T, loading: false });
      return;
    }
    setState((s) => ({ data: s.data, loading: true }));
    fetchCached(key, () => fnRef.current())
      .then((d) => alive && setState({ data: d, loading: false }))
      .catch((e) => alive && setState({ error: String(e?.message ?? e), loading: false }));
    return () => {
      alive = false;
    };
  }, [key, nonce]);

  const refetch = () => {
    if (key) cache.delete(key);
    setNonce((n) => n + 1);
  };
  return { ...state, refetch };
}
