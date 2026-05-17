import { useEffect, useState, type DependencyList } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

// Collapses the boilerplate fetch-with-cancellation pattern. The fetcher
// receives an AbortSignal so it can hand it through to fetch() — when the
// component unmounts (or deps change), the signal aborts and any pending
// resolution is dropped.
export function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const ctrl = new AbortController();
    setState((prev) => ({ data: prev.data, loading: true, error: null }));
    fetcher(ctrl.signal).then(
      (data) => {
        if (ctrl.signal.aborted) return;
        setState({ data, loading: false, error: null });
      },
      (error: unknown) => {
        if (ctrl.signal.aborted) return;
        // AbortError comes through here on some platforms even though we
        // already gated on signal.aborted — drop it explicitly.
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      },
    );
    return () => {
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
