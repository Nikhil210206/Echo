import { useEffect, useRef, useState } from "react";
import { subscribeLive } from "./api";
import type { LiveEvent } from "./types";

/** Subscribe to live events for the lifetime of a component. */
export function useLive(onEvent: (e: LiveEvent) => void) {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => subscribeLive((e) => handler.current(e), setConnected), []);
  return connected;
}
