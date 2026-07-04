import { decrypt } from "./cryptoService.js";

/**
 * Execute a stock paper trade via Alpaca Sandbox API.
 * Falls back gracefully to mock trade if API credentials are not provided.
 *
 * @param {string} apiKeyEncrypted - AES-256 encrypted Alpaca Key ID.
 * @param {string} apiSecretEncrypted - AES-256 encrypted Alpaca Secret Key.
 * @param {string} symbol - Ticker symbol (e.g., AAPL).
 * @param {number} qty - Share quantity.
 * @param {string} side - 'buy' or 'sell'.
 */
export async function executeAlpacaTrade(apiKeyEncrypted: string, apiSecretEncrypted: string, symbol: string, qty: number, side: string) {
  let apiKey = "";
  let apiSecret = "";
  try {
    apiKey = decrypt(apiKeyEncrypted);
    apiSecret = decrypt(apiSecretEncrypted);
  } catch (err) {
    // Ignore decryption errors for unconfigured or plaintext fallback values
  }

  if (!apiKey || !apiSecret) {
    console.log(`[Alpaca Mock] Executing mock ${side.toUpperCase()} order for ${qty} ${symbol}`);
    return {
      success: true,
      mock: true,
      order_id: "mock_apca_" + Math.random().toString(36).substring(2, 12),
      status: "filled"
    };
  }

  const url = "https://paper-api.alpaca.markets/v2/orders";
  const body = {
    symbol: symbol.toUpperCase(),
    qty: String(qty),
    side: side.toLowerCase(),
    type: "market",
    time_in_force: "gtc",
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "APCA-API-KEY-ID": apiKey,
        "APCA-API-SECRET-KEY": apiSecret,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Alpaca API error: ${res.status} - ${errText}`);
    }

    const data = await res.json();
    return {
      success: true,
      mock: false,
      order_id: data.id,
      status: data.status,
      raw: data
    };
  } catch (err: any) {
    console.error("Alpaca trade execution failed:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Execute a crypto trade via Binance Testnet API.
 * Falls back gracefully to mock trade if API credentials are not provided.
 *
 * @param {string} apiKeyEncrypted - AES-256 encrypted Binance API Key.
 * @param {string} apiSecretEncrypted - AES-256 encrypted Binance API Secret.
 * @param {string} symbol - Crypto coin symbol (e.g., BTC).
 * @param {number} qty - Coin quantity.
 * @param {string} side - 'BUY' or 'SELL'.
 */
export async function executeBinanceTrade(apiKeyEncrypted: string, apiSecretEncrypted: string, symbol: string, qty: number, side: string) {
  let apiKey = "";
  let apiSecret = "";
  try {
    apiKey = decrypt(apiKeyEncrypted);
    apiSecret = decrypt(apiSecretEncrypted);
  } catch (err) {
    // Ignore decryption errors
  }

  if (!apiKey || !apiSecret) {
    console.log(`[Binance Mock] Executing mock ${side.toUpperCase()} order for ${qty} ${symbol}`);
    return {
      success: true,
      mock: true,
      order_id: "mock_binance_" + Math.random().toString(36).substring(2, 12),
      status: "FILLED"
    };
  }

  const baseUrl = "https://testnet.binance.vision";
  const endpoint = "/api/v3/order";
  
  const timestamp = Date.now();
  const symbolUSDT = `${symbol.toUpperCase()}USDT`;
  const queryString = `symbol=${symbolUSDT}&side=${side.toUpperCase()}&type=MARKET&quantity=${qty}&timestamp=${timestamp}`;
  
  try {
    const crypto = await import("crypto");
    const signature = crypto
      .createHmac("sha256", apiSecret)
      .update(queryString)
      .digest("hex");
      
    const url = `${baseUrl}${endpoint}?${queryString}&signature=${signature}`;
    
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": apiKey,
        "Accept": "application/json"
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Binance API error: ${res.status} - ${errText}`);
    }

    const data = await res.json();
    return {
      success: true,
      mock: false,
      order_id: data.orderId,
      status: data.status,
      raw: data
    };
  } catch (err: any) {
    console.error("Binance trade execution failed:", err.message);
    return { success: false, error: err.message };
  }
}
