// Central WebSocket publisher subscribing to live tickers from Binance Spot WebSocket stream
// and broadcasting real-time price updates to connected Socket.io browser clients.

import WebSocket from "ws";

const SYMBOLS = [
  "btc", "eth", "sol", "bnb", "xrp", "ada", "avax", "doge", "matic", "link", "near", "arb"
];

let wsClient: any = null;
let reconnectTimeout: any = null;
export const latestPrices: Record<string, any> = {};

export function initWebSocketService(io: any) {
  if (!io) {
    console.warn("Socket.io instance not provided to WebSocketService. Skipping initialization.");
    return;
  }

  // Construct Binance WebSocket URL subscribing to multiple ticker streams
  const streams = SYMBOLS.map(sym => `${sym}usdt@ticker`).join("/");
  const wsUrl = `wss://stream.binance.com:9443/ws/${streams}`;

  function connect() {
    console.log("Connecting to Binance Spot WebSocket stream...");
    
    // Use native globalThis.WebSocket if available, otherwise fall back to imported ws package
    const WebSocketClass = globalThis.WebSocket || WebSocket;

    try {
      wsClient = new WebSocketClass(wsUrl);

      wsClient.onopen = () => {
        console.log("✅ Connected to Binance Spot WebSocket stream");
      };

      wsClient.onmessage = (event: any) => {
        try {
          const msg = JSON.parse(event.data);
          // Binance mini-ticker / ticker payload mapping
          // s: symbol, c: close price, P: price change percent, h: high, l: low, v: volume, E: event time
          if (msg && msg.e === "24hrTicker") {
            const payload = {
              symbol: msg.s.replace("USDT", ""),
              price: parseFloat(msg.c),
              changePercent: parseFloat(msg.P),
              high: parseFloat(msg.h),
              low: parseFloat(msg.l),
              volume: parseFloat(msg.v) * parseFloat(msg.c), // Convert base asset volume to USD
              timestamp: msg.E
            };
            latestPrices[payload.symbol.toUpperCase()] = payload.price;
            io.emit("tickerUpdate", payload);
          }
        } catch (err) {
          console.error("Error parsing Binance WS message:", err);
        }
      };

      wsClient.onerror = (err: any) => {
        console.error("Binance Spot WS error:", err);
      };

      wsClient.onclose = () => {
        console.warn("Binance Spot WS stream closed. Reconnecting in 5 seconds...");
        reconnectTimeout = setTimeout(connect, 5000);
      };
    } catch (err) {
      console.error("Failed to establish Binance WebSocket client:", err);
      reconnectTimeout = setTimeout(connect, 5000);
    }
  }

  connect();
}

export function closeWebSocketService() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (wsClient) {
    wsClient.onclose = null;
    wsClient.onmessage = null;
    wsClient.onopen = null;
    // Keep a dummy error listener during close to swallow asynchronous errors
    wsClient.onerror = () => {};
    try {
      wsClient.close();
    } catch (e) {}
    wsClient = null;
  }
}

