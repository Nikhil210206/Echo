import { useEffect, useRef, useState } from "react";
import { subscribeLive } from "./api";
import { useAuth } from "./auth";
import type { LiveEvent } from "./types";

/** Subscribe to live events for the lifetime of a component. Admins only: the stream carries every
 * report on campus, so the backend refuses staff (who only see their assigned issues). */
export function useLive(onEvent: (e: LiveEvent) => void) {
  const { user } = useAuth();
  const canListen = user?.role === "admin";
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => (canListen ? subscribeLive((e) => handler.current(e), setConnected) : undefined), [canListen]);
  return connected;
}
