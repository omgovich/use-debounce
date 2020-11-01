import { useRef, useEffect, useMemo } from 'react';

export interface Options {
  maxWait?: number;
  leading?: boolean;
  trailing?: boolean;
}

export interface ControlFunctions {
  cancel: () => void;
  flush: () => void;
  pending: () => boolean;
}

export interface DebouncedState<T extends (...args: any[]) => ReturnType<T>> extends ControlFunctions {
  callback: (...args: Parameters<T>) => ReturnType<T>;
}

export default function useDebouncedCallback<T extends (...args: any[]) => ReturnType<T>>(
  func: T,
  wait: number,
  options?: Options
): DebouncedState<T> {
  const lastCallTime = useRef(null);
  const lastInvokeTime = useRef(0);
  const timerId = useRef(null);
  const lastArgs = useRef<unknown[]>([]);
  const lastThis = useRef();
  const result = useRef();
  const funcRef = useRef(func);
  const mounted = useRef(true);
  funcRef.current = func;

  // Bypass `requestAnimationFrame` by explicitly setting `wait=0`.
  const useRAF = !wait && wait !== 0 && typeof window !== 'undefined';

  if (typeof func !== 'function') {
    throw new TypeError('Expected a function');
  }

  wait = +wait || 0;
  options = options || {};

  const leading = !!options.leading;
  const trailing = 'trailing' in options ? !!options.trailing : true; // `true` by default
  const maxing = 'maxWait' in options;
  const maxWait = maxing ? Math.max(+options.maxWait || 0, wait) : null;

  const invokeFunc = (time) => {
    const args = lastArgs.current;
    const thisArg = lastThis.current;

    lastArgs.current = lastThis.current = null;
    lastInvokeTime.current = time;
    return (result.current = funcRef.current.apply(thisArg, args));
  };

  const startTimer = (pendingFunc, wait) => {
    if (useRAF) cancelAnimationFrame(timerId.current);
    timerId.current = useRAF ? requestAnimationFrame(pendingFunc) : setTimeout(pendingFunc, wait);
  };

  const shouldInvoke = (time) => {
    if (!mounted.current) return false;

    const timeSinceLastCall = time - lastCallTime.current;
    const timeSinceLastInvoke = time - lastInvokeTime.current;

    // Either this is the first call, activity has stopped and we're at the
    // trailing edge, the system time has gone backwards and we're treating
    // it as the trailing edge, or we've hit the `maxWait` limit.
    return (
      !lastCallTime.current ||
      timeSinceLastCall >= wait ||
      timeSinceLastCall < 0 ||
      (maxing && timeSinceLastInvoke >= maxWait)
    );
  };

  const trailingEdge = (time) => {
    timerId.current = null;

    // Only invoke if we have `lastArgs` which means `func` has been
    // debounced at least once.
    if (trailing && lastArgs.current) {
      return invokeFunc(time);
    }
    lastArgs.current = lastThis.current = null;
    return result.current;
  };

  const timerExpired = () => {
    const time = Date.now();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }

    // Remaining wait calculation
    const timeSinceLastCall = time - lastCallTime.current;
    const timeSinceLastInvoke = time - lastInvokeTime.current;
    const timeWaiting = wait - timeSinceLastCall;
    const remainingWait = maxing ? Math.min(timeWaiting, maxWait - timeSinceLastInvoke) : timeWaiting;

    // Restart the timer
    startTimer(timerExpired, remainingWait);
  };

  const cancel = () => {
    if (timerId.current) {
      useRAF ? cancelAnimationFrame(timerId.current) : clearTimeout(timerId.current);
    }
    lastInvokeTime.current = 0;
    lastArgs.current = lastCallTime.current = lastThis.current = timerId.current = null;
  };

  const flush = () => {
    return !timerId.current ? result.current : trailingEdge(Date.now());
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const debounced = (...args: Parameters<T>): ReturnType<T> => {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);

    lastArgs.current = args;
    lastThis.current = this;
    lastCallTime.current = time;

    if (isInvoking) {
      if (!timerId.current && mounted.current) {
        // Reset any `maxWait` timer.
        lastInvokeTime.current = lastCallTime.current;
        // Start the timer for the trailing edge.
        startTimer(timerExpired, wait);
        // Invoke the leading edge.
        return leading ? invokeFunc(lastCallTime.current) : result.current;
      }
      if (maxing) {
        // Handle invocations in a tight loop.
        startTimer(timerExpired, wait);
        return invokeFunc(lastCallTime.current);
      }
    }
    if (!timerId.current) {
      startTimer(timerExpired, wait);
    }
    return result.current;
  };

  const pending = () => {
    return !!timerId.current;
  };

  const state = {
    callback: debounced,
    cancel,
    flush,
    pending,
  };

  const debouncedState = useRef<DebouncedState<T>>(state);

  // Update debouncedState's content without changing a link to the object
  return Object.assign(debouncedState.current, state);
}
