import assert from "node:assert/strict";
import test from "node:test";
import { readEventStream } from "../src/lib/eventStream.ts";

const encoder = new TextEncoder();
function byteStream(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

test("reads split UTF-8, comments, and mixed SSE line endings", async () => {
  const bytes = encoder.encode(': heartbeat\r\n\r\ndata: {"name":"café",\r\ndata: "type":"feedback"}\r\n\r\n' +
    'data: {"type":"moderation"}\r\r');
  const oneByteChunks = Array.from(bytes, (value) => Uint8Array.of(value));
  const messages = [];
  await readEventStream(byteStream(oneByteChunks), (data) => messages.push(JSON.parse(data)));
  assert.deepEqual(messages, [{ name: "café", type: "feedback" }, { type: "moderation" }]);
});

test("bounds memory when a malformed stream omits a line ending", async () => {
  const stream = byteStream([encoder.encode("x".repeat(1_048_577))]);
  await assert.rejects(readEventStream(stream, () => assert.fail("Unexpected event")), /frame too large/);
});
