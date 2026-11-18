const MAX_FRAME = 1_048_576;

/** Decode SSE data frames across network chunks. Comments are heartbeats. */
export async function readEventStream(stream: ReadableStream<Uint8Array>, onData: (data: string) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let data: string[] = [];
  let frameSize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });

      let end = pending.search(/[\r\n]/);
      while (end >= 0) {
        if (!done && pending[end] === "\r" && end === pending.length - 1) break;
        const line = pending.slice(0, end);
        pending = pending.slice(end + (pending.slice(end, end + 2) === "\r\n" ? 2 : 1));
        if (line === "") {
          if (data.length) onData(data.join("\n"));
          data = [];
          frameSize = 0;
        } else {
          frameSize += line.length + 1;
          if (frameSize > MAX_FRAME) throw new Error("Event stream frame too large");
          if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        end = pending.search(/[\r\n]/);
      }
      if (frameSize + pending.length > MAX_FRAME) throw new Error("Event stream frame too large");
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
