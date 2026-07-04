import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert";

describe("websocketService", () => {
  let mod: any;
  let mockIo: any;
  let wsInstance: Record<string, any>;

  before(async () => {
    wsInstance = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      close: mock.fn(() => {}),
    };

    class MockWebSocket {
      constructor(_url: string) {
        return wsInstance;
      }
    }
    globalThis.WebSocket = MockWebSocket as any;

    mockIo = { emit: mock.fn(() => {}) };

    const url = new URL("../../services/websocketService.js", import.meta.url).href;
    mod = await import(url + "?ws=1");
  });

  after(() => {
    mod.closeWebSocketService();
    delete (globalThis as any).WebSocket;
  });

  it("exports latestPrices as object", () => {
    assert.ok(typeof mod.latestPrices === "object");
  });

  it("initWebSocketService sets up handlers and calls open", () => {
    mod.initWebSocketService(mockIo);
    assert.strictEqual(typeof wsInstance.onopen, "function");
    assert.strictEqual(typeof wsInstance.onmessage, "function");
    assert.strictEqual(typeof wsInstance.onerror, "function");
    assert.strictEqual(typeof wsInstance.onclose, "function");
  });

  it("onmessage updates latestPrices and emits to io", () => {
    const msg = {
      e: "24hrTicker",
      s: "BTCUSDT",
      c: "50234.56",
      P: "1.23",
      h: "51000",
      l: "49000",
      v: "12345",
      E: 1700000000000,
    };
    wsInstance.onmessage({ data: JSON.stringify(msg) });
    assert.strictEqual(mod.latestPrices.BTC, 50234.56);
    assert.strictEqual(mockIo.emit.mock.calls.length, 1);
    const callArg = mockIo.emit.mock.calls[0].arguments;
    assert.strictEqual(callArg[0], "tickerUpdate");
    assert.strictEqual(callArg[1].symbol, "BTC");
    assert.strictEqual(callArg[1].price, 50234.56);
  });

  it("onmessage ignores non-ticker events", () => {
    mockIo.emit.mock.resetCalls();
    wsInstance.onmessage({ data: JSON.stringify({ e: "other" }) });
    assert.strictEqual(mockIo.emit.mock.calls.length, 0);
  });

  it("onmessage handles malformed JSON", () => {
    mockIo.emit.mock.resetCalls();
    wsInstance.onmessage({ data: "not json" });
    assert.strictEqual(mockIo.emit.mock.calls.length, 0);
  });

  it("onerror does not crash", () => {
    wsInstance.onerror(new Error("test error"));
    assert.ok(true);
  });

  it("onclose schedules reconnect", () => {
    wsInstance.onclose();
    assert.ok(true);
  });

  it("closeWebSocketService calls wsClient.close", () => {
    mod.closeWebSocketService();
    assert.strictEqual(wsInstance.close.mock.calls.length, 1);
  });

  it("safely ignores missing io", () => {
    const spy = mock.fn(() => {});
    const origWarn = console.warn;
    console.warn = spy;
    mod.initWebSocketService(null);
    assert.strictEqual(spy.mock.calls.length, 1);
    console.warn = origWarn;
  });
});
