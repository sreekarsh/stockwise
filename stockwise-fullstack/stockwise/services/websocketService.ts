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
    
    const WebSocketClass = globalThis.WebSocket || WebSocket;

    try {
      wsClient = new WebSocketClass(wsUrl);

      wsClient.onopen = () => {
        console.log("Connected to Binance Spot WebSocket stream");
      };

      wsClient.onmessage = (event: any) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg && msg.e === "24hrTicker") {
            const payload = {
              symbol: msg.s.replace("USDT", ""),
              price: parseFloat(msg.c),
              changePercent: parseFloat(msg.P),
              high: parseFloat(msg.h),
              low: parseFloat(msg.l),
              volume: parseFloat(msg.v) * parseFloat(msg.c),
              timestamp: msg.E
            };
            latestPrices[payload.symbol.toUpperCase()] = payload.price;
            io.emit("tickerUpdate", payload);
          }
        } catch (err) {
          console.error("Error parsing Binance WS message:", err);
        }
      };

      wsClient.onerror = () => {
        console.warn("Binance Spot WS unavailable — using CoinGecko fallback");
        wsClient.onclose = null;
        try { wsClient.close(); } catch {}
        wsClient = null;
      };

      wsClient.onclose = () => {
        if (wsClient) {
          console.warn("Binance Spot WS stream closed. Reconnecting in 5 seconds...");
          reconnectTimeout = setTimeout(connect, 5000);
        }
      };
    } catch (err) {
      console.warn("Binance Spot WS unavailable — using CoinGecko fallback");
    }
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

