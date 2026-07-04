{
let currentUser: any = null;
let holdings = [];
let trades = [];
let livePrices = {};
let weightingsChart = null;
let currentSort = "value";
let currentTab = "holdings";
let tickerScrollAmount = 0;
let syncInterval = null;
let marketsData = [];
let performanceChartInstance = null;
let activeChartTab = "alloc";
let lastPriceUpdate = null; // timestamp of last successful price fetch
let priceCountdownTimer = null; // interval for the live countdown display
let priceRefreshTimer = null; // main auto-refresh interval
const PRICE_REFRESH_MS = 20000; // 20 seconds
let usdInrRate = 95.3;
let _initialLoadComplete = false;
const _refreshedByPoll: Set<string> = new Set();

function escAttr(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  initTickerNav();
  initSpotlightGlows();
  showToast("Loading portfolio data...", "info");
  await fetchUser();
  await getUsdInrRate();
  initRealtimeUpdates();
  await fetchHoldings();
  await fetchTrades();
  await fetchLivePrices();
  renderAll();
  _initialLoadComplete = true;
  startPriceCountdown();
  startPricePolling();
}

function bindEvents() {
  // Exchange Keys Modal
  document.getElementById("btnExchangeKeys").addEventListener("click", () => {
    if (!currentUser || !currentUser.loggedIn) {
      showToast("Please login to connect your exchange keys.", "err");
      if (window.stockwise && window.stockwise.openAuth) {
        window.stockwise.openAuth("login");
      }
      return;
    }
    resetPortfolioPwFields();
    const triggerSyncBtn = document.getElementById("btnTriggerSync");
    if (currentUser.has_coindcx_secret) {
      document.getElementById("dcxKey").value = currentUser.coindcx_key || "••••••••••••••••";
      document.getElementById("dcxSecret").value = "••••••••••••••••";
      if (triggerSyncBtn) triggerSyncBtn.style.display = "inline-block";
    } else {
      document.getElementById("dcxKey").value = "";
      document.getElementById("dcxSecret").value = "";
      if (triggerSyncBtn) triggerSyncBtn.style.display = "none";
    }
    document.getElementById("keysModal").classList.add("active");
  });
  document.getElementById("btnCancelKeys").addEventListener("click", () => {
    document.getElementById("keysModal").classList.remove("active");
    resetPortfolioPwFields();
  });
  document.getElementById("btnSaveKeys").addEventListener("click", saveKeys);

  const triggerSyncBtn = document.getElementById("btnTriggerSync");
  if (triggerSyncBtn) {
    triggerSyncBtn.addEventListener("click", async () => {
      // First save keys if they've been entered
      const key = document.getElementById("dcxKey").value.trim();
      const secret = document.getElementById("dcxSecret").value.trim();
      if (key && secret && (key !== "••••••••••••••••" || secret !== "••••••••••••••••")) {
        const payload = {};
        if (key !== "••••••••••••••••") payload.coindcx_key = key;
        if (secret !== "••••••••••••••••") payload.coindcx_secret = secret;
        try {
          const res = await fetch("/api/api-keys", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (res.ok) await fetchUser();
          else
            console.warn(
              "Failed to save API keys:",
              await res.json().catch(() => ({})),
            );
        } catch (e) {
          console.error("API keys save error:", e);
        }
      }
      document.getElementById("keysModal").classList.remove("active");
      resetPortfolioPwFields();
      await syncDCX();
    });
  }

  // Add Asset Modal
  document.getElementById("btnAddHolding").addEventListener("click", () => {
    if (!currentUser || !currentUser.loggedIn) {
      showToast("Please login to add assets manually.", "err");
      if (window.stockwise && window.stockwise.openAuth) {
        window.stockwise.openAuth("login");
      }
      return;
    }
    openAddHoldingModal();
  });
  document
    .getElementById("btnCancelHolding")
    .addEventListener("click", closeHoldingModal);
  document
    .getElementById("btnSaveHolding")
    .addEventListener("click", saveHolding);

  // Search and Sort
  document.getElementById("searchInput").addEventListener("input", () => {
    renderTabContent();
  });

  document.querySelectorAll(".sort-btn").forEach((btn) => {
    if (btn.id === "btnExport") return;
    btn.addEventListener("click", (e) => {
      document
        .querySelectorAll(".sort-btn")
        .forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      currentSort = e.target.dataset.sort;
      renderTabContent();
    });
  });

  document.getElementById("btnExport").addEventListener("click", exportCSV);

  // Manual price refresh button
  const refreshBtn = document.getElementById("btnRefreshPrices");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      await fetchLivePrices();
      renderAll();
    });
  }

  // Tabs
  document
    .getElementById("tabHoldings")
    .addEventListener("click", () => switchPortfolioTab("holdings"));
  document
    .getElementById("tabTrades")
    .addEventListener("click", () => switchPortfolioTab("trades"));
  document
    .getElementById("tabDist")
    .addEventListener("click", () => switchPortfolioTab("dist"));

  // Chart tab switching
  const tabAlloc = document.getElementById("chartTabAlloc");
  const tabPerf = document.getElementById("chartTabPerf");
  if (tabAlloc && tabPerf) {
    tabAlloc.addEventListener("click", () => switchChartTab("alloc"));
    tabPerf.addEventListener("click", () => switchChartTab("perf"));
  }

  // Event delegation for the dynamic "Load Demo Portfolio" button in table body
  const tbody = document.getElementById("tableBody");
  if (tbody) {
    tbody.addEventListener("click", (e) => {
      if (e.target && e.target.id === "btnLoadDemoPortfolio") {
        loadDemoPortfolio();
      }
    });
  }

  // Listen to Auth state changes globally to automatically update dashboard data
  window.addEventListener("auth-changed", async (e) => {
    // Only clear holdings if we were previously logged in and now logged out
    const wasLoggedIn = holdings.length > 0 || trades.length > 0;
    if (e.detail && e.detail.loggedIn) {
      await fetchUser();
      await fetchHoldings();
      await fetchTrades();
      await fetchLivePrices();
      renderAll();
    } else if (wasLoggedIn) {
      holdings = [];
      trades = [];
      if (pricePollTimer) clearInterval(pricePollTimer);
      if (priceCountdownTimer) clearInterval(priceCountdownTimer);
      renderAll();
    }
  });
}

function switchChartTab(tab) {
  activeChartTab = tab;
  const tabAlloc = document.getElementById("chartTabAlloc");
  const tabPerf = document.getElementById("chartTabPerf");
  const allocSec = document.getElementById("allocChartSection");
  const perfSec = document.getElementById("perfChartSection");

  if (tab === "alloc") {
    if (tabAlloc) tabAlloc.classList.add("active");
    if (tabPerf) tabPerf.classList.remove("active");
    if (allocSec) allocSec.style.display = "block";
    if (perfSec) perfSec.style.display = "none";
  } else {
    if (tabAlloc) tabAlloc.classList.remove("active");
    if (tabPerf) tabPerf.classList.add("active");
    if (allocSec) allocSec.style.display = "none";
    if (perfSec) perfSec.style.display = "block";
    renderPerformanceChart();
  }
}

function initTickerNav() {
  // Elements might not exist on some renders/pages. Avoid crashing on null.
  const nextBtn = document.getElementById("tickerNext");
  const prevBtn = document.getElementById("tickerPrev");

  const track = document.getElementById("tickerTrack");

  if (!track) return;

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const container = track.parentElement;
      if (container) {
        const maxScroll = track.scrollWidth - container.clientWidth;
        tickerScrollAmount += 200;
        if (tickerScrollAmount > maxScroll) {
          tickerScrollAmount = maxScroll > 0 ? maxScroll : 0;
        }
        track.style.transform = `translateX(-${tickerScrollAmount}px)`;
      }
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      tickerScrollAmount -= 200;
      if (tickerScrollAmount < 0) tickerScrollAmount = 0;
      track.style.transform = `translateX(-${tickerScrollAmount}px)`;
    });
  }
}

function switchPortfolioTab(tabName) {
  currentTab = tabName;
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));

  if (tabName === "holdings") {
    document.getElementById("tabHoldings").classList.add("active");
  } else if (tabName === "trades") {
    document.getElementById("tabTrades").classList.add("active");
  } else if (tabName === "dist") {
    document.getElementById("tabDist").classList.add("active");
  }

  renderTabContent();
}

async function fetchHoldings() {
  try {
    const res = await fetch("/api/portfolio?_t=" + Date.now(), {
      credentials: "include",
    });
    if (res.ok) holdings = await res.json();
  } catch (e) {
    console.error("Error fetching holdings", e);
  }
}

async function fetchTrades() {
  try {
    const res = await fetch("/api/trade-history?_t=" + Date.now(), {
      credentials: "include",
    });
    if (res.ok) trades = await res.json();
  } catch (e) {
    console.error("Error fetching trades", e);
  }
}

async function fetchLivePrices() {
  // Show spinner on the refresh button if visible
  const refreshBtn = document.getElementById("btnRefreshPrices");
  if (refreshBtn) {
    refreshBtn.classList.add("spinning");
    refreshBtn.disabled = true;
  }

  try {
    // 1. Gather all CoinGecko IDs for our holdings to fetch long-tail assets (like EPIC) that are outside the top 250 list
    const COINGECKO_ID_MAP = {
      BTC: "bitcoin",
      ETH: "ethereum",
      SOL: "solana",
      BNB: "binancecoin",
      XRP: "ripple",
      ADA: "cardano",
      AVAX: "avalanche-2",
      DOGE: "dogecoin",
      DOT: "polkadot",
      LINK: "chainlink",
      MATIC: "matic-network",
      TRX: "tron",
      SHIB: "shiba-inu",
      LTC: "litecoin",
      BCH: "bitcoin-cash",
      ATOM: "cosmos",
      NEAR: "near",
      APT: "aptos",
      ARB: "arbitrum",
      OP: "optimism",
      INJ: "injective-protocol",
      VET: "vechain",
      ALGO: "algorand",
      ICP: "internet-computer",
      FIL: "filecoin",
      EOS: "eos",
      AAVE: "aave",
      MKR: "maker",
      UNI: "uniswap",
      XLM: "stellar",
      ETC: "ethereum-classic",
      XMR: "monero",
      ZEC: "zcash",
      PEPE: "pepe",
      HBAR: "hedera-hashgraph",
      MON: "mon-protocol",
      SUPRA: "supra",
      PUMP: "pump",
      EPIC: "epic-chain",
    };

    const targetIds = holdings
      .map((h) => COINGECKO_ID_MAP[h.symbol.toUpperCase()])
      .filter(Boolean);

    // Fetch CoinDCX and CoinGecko in PARALLEL for max speed.
    // CoinDCX is the authoritative source — its prices override CoinGecko for all holdings.
    const [dcxResult, cgResult, cgHoldingsResult] = await Promise.allSettled([
      fetch("/api/coindcx/markets?vs_currency=inr&fresh=1").then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch("/api/markets?per_page=250&vs_currency=inr&price_change_percentage=1h,24h,7d").then((r) =>
        r.ok ? r.json() : null,
      ),
      targetIds.length > 0
        ? fetch(`/api/markets?vs_currency=inr&ids=${targetIds.join(",")}&price_change_percentage=1h,24h,7d`).then(
            (r) => (r.ok ? r.json() : null),
          )
        : Promise.resolve(null),
    ]);

    const dcxData = dcxResult.status === "fulfilled" ? dcxResult.value : null;
    const cgData = cgResult.status === "fulfilled" ? cgResult.value : null;
    const cgHoldingsData =
      cgHoldingsResult && cgHoldingsResult.status === "fulfilled"
        ? cgHoldingsResult.value
        : null;

    // Track coins refreshed by the poll so the Socket handler doesn't overwrite
    // their exact CoinDCX/CoinGecko INR prices with Binance-tracked approximations
    _refreshedByPoll.clear();

    // 1. Seed with CoinGecko data (broader coverage, logos, 24h change)
    if (Array.isArray(cgData)) {
      marketsData = cgData;
      cgData.forEach((c) => {
        const sym = (c.symbol || "").toUpperCase();
        _refreshedByPoll.add(sym);
        const existing = livePrices[sym];
        livePrices[sym] = {
          price: c.current_price,
          change: c.price_change_percentage_24h || 0,
          change7d: c.price_change_percentage_7d_in_currency || 0,
          image: c.image || null,
        };
      });
    }

    // 1b. Seed/Override with CoinGecko specific holdings data (for assets outside top 250)
    if (Array.isArray(cgHoldingsData)) {
      if (!Array.isArray(marketsData)) marketsData = [];
      cgHoldingsData.forEach((c) => {
        const sym = (c.symbol || "").toUpperCase();
        _refreshedByPoll.add(sym);
        // Merge into marketsData if not present (helps resolve CoinGecko IDs in chart)
        if (!marketsData.some((m) => (m.symbol || "").toUpperCase() === sym)) {
          marketsData.push(c);
        }
        const existing = livePrices[sym];
        livePrices[sym] = {
          price: c.current_price,
          change: c.price_change_percentage_24h || 0,
          change7d: c.price_change_percentage_7d_in_currency || 0,
          image: c.image || (existing ? existing.image : null),
        };
      });
    }

    // 2. Override with CoinDCX prices — always fresher for INR pairs
    // Preserve CoinGecko 24h change if CoinDCX doesn't provide it
    // Socket handler will NOT overwrite CoinDCX prices — they stay exact.
    if (Array.isArray(dcxData)) {
      dcxData.forEach((d) => {
        if (d.symbol && d.current_price > 0) {
          const sym = d.symbol.toUpperCase();
          _refreshedByPoll.add(sym);
          const existing = livePrices[sym];
          livePrices[sym] = {
            price: d.current_price,
            change:
              d.price_change_percentage_24h !== undefined
                ? d.price_change_percentage_24h
                : (existing?.change ?? 0),
            change7d: existing?.change7d ?? 0,
            image: existing?.image || d.image || null,
          };
        }
      });
    }

    // Mark last successful update time
    lastPriceUpdate = Date.now();
    updatePriceTimestamp();

    // Build carousel from combined live prices
    const carouselData = [];
    for (const sym in livePrices) {
      if (livePrices[sym].price > 0) {
        carouselData.push({
          symbol: sym,
          current_price: livePrices[sym].price,
          price_change_percentage_24h: livePrices[sym].change,
        });
      }
    }
    renderCarousel(carouselData);
  } catch (e) {
    console.error("Error fetching prices", e);
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove("spinning");
      refreshBtn.disabled = false;
    }
  }
}

// ── LIVE COUNTDOWN DISPLAY ──
function updatePriceTimestamp() {
  const el = document.getElementById("priceLastUpdated");
  if (!el || !lastPriceUpdate) return;
  const secs = Math.floor((Date.now() - lastPriceUpdate) / 1000);
  if (secs < 5) {
    el.textContent = "just now";
  } else {
    el.textContent = secs + "s ago";
  }
}

function startPriceCountdown() {
  if (priceCountdownTimer) clearInterval(priceCountdownTimer);
  priceCountdownTimer = setInterval(updatePriceTimestamp, 1000);
}

let pricePollTimer: any = null;
function startPricePolling() {
  if (pricePollTimer) clearInterval(pricePollTimer);
  pricePollTimer = setInterval(async () => {
    await fetchLivePrices();
    renderAll();
  }, 60_000);
}

async function fetchUser() {
  try {
    const res = await fetch("/api/me", { credentials: "include" });
    if (res.ok) {
      currentUser = await res.json();
      updateSyncStatusUI();
    }
  } catch (e) {
    console.error("Error fetching user info", e);
  }
}

function updateSyncStatusUI() {
  const indicator = document.getElementById("syncStatusIndicator");
  if (!indicator) return;

  if (currentUser && currentUser.loggedIn && currentUser.has_coindcx) {
    indicator.style.display = "inline-flex";
    const dot = indicator.querySelector(".sync-dot");
    const text = indicator.querySelector(".sync-text");

    if (currentUser.coindcx_sync_status === "syncing") {
      indicator.className = "sync-status-indicator syncing";
      if (dot) dot.className = "sync-dot pulse";
      if (text) text.textContent = "Syncing...";
      startSyncPolling();
    } else if (currentUser.coindcx_sync_status === "success") {
      indicator.className = "sync-status-indicator success";
      if (dot) dot.className = "sync-dot";
      const lastSynced = currentUser.coindcx_last_synced
        ? new Date(currentUser.coindcx_last_synced).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Just now";
      if (text) text.textContent = `Synced at ${lastSynced}`;
    } else if (currentUser.coindcx_sync_status === "failed") {
      indicator.className = "sync-status-indicator failed";
      if (dot) dot.className = "sync-dot";
      const errText = currentUser.coindcx_sync_error || "Sync Failed";
      if (text) text.textContent = errText;
      indicator.title = errText;
    } else {
      indicator.className = "sync-status-indicator";
      if (dot) dot.className = "sync-dot";
      if (text) text.textContent = "Ready to sync";
    }
  } else {
    indicator.style.display = "none";
  }
}

function startSyncPolling() {
  if (syncInterval) return;
  syncInterval = setInterval(async () => {
    await fetchUser();
    if (!currentUser || currentUser.coindcx_sync_status !== "syncing") {
      clearInterval(syncInterval);
      syncInterval = null;
      if (currentUser && currentUser.coindcx_sync_status === "success") {
        showToast("CoinDCX synced successfully!", "success");
      } else if (currentUser && currentUser.coindcx_sync_status === "failed") {
        showToast(
          "CoinDCX sync failed: " +
            (currentUser.coindcx_sync_error || "Unknown error"),
          "err",
        );
      }
      await fetchHoldings();
      await fetchTrades();
      await fetchLivePrices();
      renderAll();

      // Post-sync UX: show banner, highlight rows, scroll to table
      if (currentUser && currentUser.coindcx_sync_status === "success") {
        showSyncBanner(holdings.length);
        highlightSyncedRows();
        scrollToPortfolioTable();
      }
    }
  }, 2000);
}

/**
 * Shows a dismissable green banner above the table confirming sync completion.
 */
function showSyncBanner(assetCount) {
  // Remove any existing banner
  document.getElementById("syncCompleteBanner")?.remove();

  const lastSynced = currentUser?.coindcx_last_synced
    ? new Date(currentUser.coindcx_last_synced).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "just now";

  const banner = document.createElement("div");
  banner.id = "syncCompleteBanner";
  banner.className = "sync-complete-banner";
  banner.innerHTML = `
    <span class="sync-icon">✅</span>
    <span>CoinDCX sync complete &mdash; <strong>${assetCount} asset${assetCount !== 1 ? "s" : ""}</strong> updated at ${lastSynced}</span>
    <span class="sync-close" title="Dismiss">✕</span>
  `;

  // Insert above the portfolio table wrap
  const tableWrap = document.querySelector(".table-wrap") ||
    document.querySelector(".table-panel") ||
    document.getElementById("tableBody")?.closest("div");

  if (tableWrap) {
    tableWrap.insertAdjacentElement("beforebegin", banner);
  } else {
    // Fallback: insert before table body
    const tbody = document.getElementById("tableBody");
    if (tbody?.parentElement?.parentElement) {
      tbody.parentElement.parentElement.insertAdjacentElement("beforebegin", banner);
    }
  }

  // Dismiss on click
  banner.querySelector(".sync-close")?.addEventListener("click", () => banner.remove());

  // Auto-dismiss after 8 seconds
  setTimeout(() => banner?.remove(), 8000);
}

/**
 * Stagger-flashes each table row with the sync-highlight animation
 * so the user can clearly see which rows were updated.
 */
function highlightSyncedRows() {
  const rows = document.querySelectorAll("#tableBody tr[data-sym]");
  if (!rows.length) return;

  rows.forEach((row, i) => {
    setTimeout(() => {
      row.classList.remove("sync-highlight");
      void row.offsetWidth; // force reflow so animation replays
      row.classList.add("sync-highlight");
      // Clean up class after animation completes
      setTimeout(() => row.classList.remove("sync-highlight"), 2200);
    }, i * 80); // 80ms stagger between rows for cascade effect
  });
}

/**
 * Smooth-scrolls the viewport to the portfolio holdings table.
 */
function scrollToPortfolioTable() {
  const target =
    document.querySelector(".table-panel") ||
    document.querySelector(".table-wrap") ||
    document.getElementById("tableBody");

  if (target) {
    setTimeout(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150); // slight delay so renderAll() DOM updates are visible first
  }
}

function togglePortfolioPw(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === "password" ? "text" : "password";
  btn.textContent = inp.type === "password" ? "👁" : "🙈";
}
window.togglePortfolioPw = togglePortfolioPw;

function resetPortfolioPwFields() {
  const dcxKey = document.getElementById("dcxKey");
  const dcxSecret = document.getElementById("dcxSecret");
  if (dcxKey) dcxKey.type = "password";
  if (dcxSecret) dcxSecret.type = "password";

  const toggleBtns = document.querySelectorAll("#keysModal .toggle-pw");
  toggleBtns.forEach((btn) => {
    btn.textContent = "👁";
  });
}

async function saveKeys() {
  const key = document.getElementById("dcxKey").value.trim();
  const secret = document.getElementById("dcxSecret").value.trim();

  if (!key) return showToast("Please enter API key.", "err");

  // If both are still dots, no changes were made. Sync directly if we have keys.
  if (key === "••••••••••••••••" && secret === "••••••••••••••••") {
    document.getElementById("keysModal").classList.remove("active");
    resetPortfolioPwFields();
    if (currentUser && currentUser.has_coindcx_secret) {
      await syncDCX();
    }
    return;
  }

  // If key was updated, but secret is still dots:
  if (key !== "••••••••••••••••" && secret === "••••••••••••••••") {
    return showToast(
      "When updating your API key, you must also re-enter your API secret.",
      "err",
    );
  }

  const payload = {};
  if (key !== "••••••••••••••••") {
    payload.coindcx_key = key;
  }
  if (secret && secret !== "••••••••••••••••") {
    payload.coindcx_secret = secret;
  } else if (!secret && (!currentUser || !currentUser.has_coindcx_secret)) {
    return showToast("Please enter API secret.", "err");
  }

  const btn = document.getElementById("btnSaveKeys");
  const oldText = btn.innerHTML;
  btn.innerHTML =
    '<span class="loader-spinner" style="width:14px;height:14px;border-width:2px;border-color:#fff;border-top-color:transparent;border-style:solid;border-radius:50%;display:inline-block;animation:spin 1s linear infinite;"></span>';

  try {
    const res = await fetch("/api/api-keys", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showToast("Keys saved successfully!", "success");
      document.getElementById("keysModal").classList.remove("active");
      document.getElementById("dcxKey").value = "";
      document.getElementById("dcxSecret").value = "";
      resetPortfolioPwFields();
      await fetchUser();
      await syncDCX();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to save keys.", "err");
    }
  } catch (e) {
    console.error(e);
    showToast("Network error.", "err");
  } finally {
    btn.innerHTML = oldText;
  }
}

async function syncDCX() {
  showToast("Initiating CoinDCX sync...", "info");
  try {
    const res = await fetch("/api/sync-coindcx", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.warn("Sync failed response:", res.status, data);
      showToast(
        data.error ||
          data.message ||
          `Failed to trigger sync (HTTP ${res.status}).`,
        "err",
      );
      return;
    }
    await fetchUser();
    showToast("Sync started successfully!", "success");
  } catch (e) {
    console.error("Sync error:", e);
    showToast("Failed to connect to server.", "err");
  }
}

// ─── ADD / EDIT HOLDING MODAL FUNCTIONS ───

function openAddHoldingModal() {
  document.getElementById("holdingModalTitle").textContent =
    "Add Asset Holding";
  document.getElementById("holdingId").value = "";
  document.getElementById("holdingSymbol").value = "";
  document.getElementById("holdingSymbol").disabled = false;
  document.getElementById("holdingName").value = "";
  document.getElementById("holdingQuantity").value = "";
  document.getElementById("holdingBuyPrice").value = "";

  document.getElementById("holdingModal").classList.add("active");
}

function openEditHoldingModal(id) {
  const h = holdings.find((item) => item.id === id);
  if (!h) return;

  document.getElementById("holdingModalTitle").textContent =
    "Edit Asset Holding";
  document.getElementById("holdingId").value = h.id;
  document.getElementById("holdingSymbol").value = h.symbol;
  document.getElementById("holdingSymbol").disabled = true;
  document.getElementById("holdingName").value = h.name;
  document.getElementById("holdingQuantity").value = h.quantity;

  // Use buy_price directly (user manual entry or synced value in DB)
  const sym = h.symbol.toUpperCase();
  const avg = h.buy_price > 0 ? h.buy_price : "";
  document.getElementById("holdingBuyPrice").value = avg;

  document.getElementById("holdingModal").classList.add("active");
}

function closeHoldingModal() {
  document.getElementById("holdingModal").classList.remove("active");
}

async function saveHolding() {
  const id = document.getElementById("holdingId").value;
  const symbol = document.getElementById("holdingSymbol").value.trim();
  const name = document.getElementById("holdingName").value.trim();
  const quantity = parseFloat(document.getElementById("holdingQuantity").value);
  const buyPriceVal = document.getElementById("holdingBuyPrice").value.trim();
  // Buy price is optional — blank means "not set" (shows — in table)
  const buyPrice = buyPriceVal === "" ? 0 : parseFloat(buyPriceVal);

  if (!symbol || !name || isNaN(quantity) || quantity <= 0) {
    return showToast(
      "Please fill in Symbol, Name, and a valid Quantity.",
      "err",
    );
  }
  // If user typed something in buy price but it's not a valid number, reject it
  if (buyPriceVal !== "" && isNaN(buyPrice)) {
    return showToast(
      "Avg Buy Price must be a valid number (or leave blank).",
      "err",
    );
  }

  const payload = {
    symbol: symbol.toUpperCase(),
    name,
    quantity,
    buy_price: buyPrice,
    asset_type: "crypto",
  };

  const saveBtn = document.getElementById("btnSaveHolding");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    let res;
    if (id) {
      // Edit mode — only include buy_price if user entered a value (don't overwrite DB with 0)
      const body = { quantity };
      if (buyPriceVal !== "") body.buy_price = buyPrice;
      res = await fetch(`/api/portfolio/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      // Add mode
      res = await fetch("/api/portfolio", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    if (res.ok) {
      showToast(
        id ? "Holding updated successfully!" : "Holding added successfully!",
        "success",
      );
      closeHoldingModal();
      await fetchHoldings();
      await fetchTrades();
      await fetchLivePrices();
      renderAll();
    } else {
      const errData = await res.json();
      showToast(errData.error || "Failed to save holding.", "err");
    }
  } catch (e) {
    console.error(e);
    showToast("Network error.", "err");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Asset";
  }
}

function openAddEditHoldingForMissing() {
  const enriched = getEnrichedHoldings();
  const missing = enriched.find((h) => !h.avgBuy);
  if (missing) {
    openEditHoldingModal(missing.id);
  } else {
    showToast("No holdings are missing a buy price.", "info");
  }
}

function getEnrichedHoldings() {
  return holdings.map((h) => {
    const sym = (h.symbol || "").toUpperCase();
    const hasLivePrice = livePrices[sym] && livePrices[sym].price > 0;
    const avg = h.buy_price > 0 ? h.buy_price : null;
    // live price: prefer exchange price, fall back to avg buy (breakeven for unknown-cost assets)
    const liveData = hasLivePrice
      ? livePrices[sym]
      : {
          price: avg || 0,
          change: 0,
          change7d: 0,
          image: livePrices[sym] ? livePrices[sym].image : null,
        };

    const livePrice = liveData.price;
    const value = h.quantity * livePrice;

    // For assets with no known buy price, treat as breakeven (pnl=0)
    const costBasis = avg || livePrice; // fallback to live price = 0 pnl
    const pnl = costBasis ? (livePrice - costBasis) * h.quantity : 0;
    const pnlPct = costBasis ? ((livePrice - costBasis) / costBasis) * 100 : 0;

    return {
      ...h,
      sym,
      livePrice,
      change24h: liveData.change,
      change7d: liveData.change7d || 0,
      image: liveData.image,
      avgBuy: avg, // null if truly unknown
      costBasis, // always has a value (either avg or live)
      value,
      pnl,
      pnlPct,
    };
  });
}

function renderAll() {
  const enriched = getEnrichedHoldings();

  // Custom Dynamic KPI Calculation
  renderCards(enriched);
  renderAlerts(enriched);
  renderTabContent(enriched);

  if (activeChartTab === "alloc") {
    renderChart(enriched);
  } else {
    renderPerformanceChart();
  }

  renderAnalytics(enriched);
}

function renderCards(enriched) {
  const totalVal = enriched.reduce((s, h) => s + h.value, 0);

  // Total invested only counts holdings with a known avg buy price (user manual entry)
  // Holdings without buy_price are excluded (not counted as invested)
  const totalCost = enriched.reduce(
    (s, h) => s + (h.avgBuy ? h.avgBuy * h.quantity : 0),
    0,
  );

  const totalPnl = totalVal - totalCost;
  const pnlPct = totalCost ? (totalPnl / totalCost) * 100 : 0;

  // Weighted 24h
  const weighted24h = totalVal
    ? enriched.reduce((s, h) => s + h.change24h * (h.value / totalVal), 0)
    : 0;

  // Weighted 7d
  const weighted7d = totalVal
    ? enriched.reduce((s, h) => s + h.change7d * (h.value / totalVal), 0)
    : 0;

  // Top Dominance
  const top = [...enriched].sort((a, b) => b.value - a.value)[0];
  const domPct = top && totalVal ? (top.value / totalVal) * 100 : 0;

  // Find card elements or recreate summary KPI row if missing
  let kpiRow = document.querySelector(".kpi-row");
  if (!kpiRow) {
    kpiRow = document.createElement("div");
    kpiRow.className = "kpi-row";
    document
      .querySelector(".portfolio-header")
      .insertAdjacentElement("afterend", kpiRow);
  }

  kpiRow.innerHTML = `
    <div class="kpi blue">
      <div class="kpi-label">TOTAL VALUATION</div>
      <div class="kpi-val blue" id="kpiTotalValuation">${formatMoney(totalVal)}</div>
      <div class="kpi-sub" id="kpiAssetCount">${enriched.length} assets tracked</div>
    </div>
    <div class="kpi purple">
      <div class="kpi-label">TOTAL CAPITAL INVESTED</div>
      <div class="kpi-val purple" id="kpiTotalCost" style="color:#c084fc;">${formatMoney(totalCost)}</div>
      <div class="kpi-sub">Total fiat cost basis</div>
    </div>
    <div class="kpi green">
      <div class="kpi-label">NET PROFIT & LOSS</div>
      <div class="kpi-val ${totalPnl >= 0 ? "green" : "red"}" id="kpiPnl">${totalPnl >= 0 ? "+" : ""}${formatMoney(totalPnl)}</div>
      <div class="kpi-sub ${totalPnl >= 0 ? "green-text" : "red-text"}" id="kpiPnlPct">${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% return</div>
    </div>
    <div class="kpi amber">
      <div class="kpi-label">24H VALUE SHIFT</div>
      <div class="kpi-val ${weighted24h >= 0 ? "green-text" : "red-text"}" id="kpi24hShift">${weighted24h >= 0 ? "+" : ""}${weighted24h.toFixed(2)}%</div>
      <div class="kpi-sub">Weighted 24h portfolio shift</div>
    </div>
    <div class="kpi red">
      <div class="kpi-label">TOP DOMINANCE</div>
      <div class="kpi-val" style="color:#ffffff;" id="kpiTopDomName">${top ? top.sym : "—"}</div>
      <div class="kpi-sub" id="kpiTopDomPct">${domPct.toFixed(1)}% Dominance</div>
    </div>
  `;
}

function renderAlerts(enriched) {
  // Flag assets where we have no buy price (P&L is partial/unknown)
  // This is NOT the same thing as "sync failed".
  const missing = enriched.filter((h) => !h.avgBuy);
  const alert = document.getElementById("missingAlert");
  if (!alert) return;

  if (missing.length) {
    document.getElementById("missingCount").textContent = missing.length;
    document.getElementById("missingNames").textContent = missing
      .map((m) => m.sym)
      .join(", ");
    alert.style.display = "block";
    return;
  }

  alert.style.display = "none";
}

function renderCarousel(data) {
  const track = document.getElementById("tickerTrack");
  if (!track) return;
  const items = data.slice(0, 25).map((c) => {
    const isUp = (c.price_change_percentage_24h || 0) >= 0;
    const clrClass = isUp ? "up" : "down";
    const sign = isUp ? "+" : "";
    return `
      <div class="ticker-item">
        <span class="ticker-sym">${(c.symbol || "").toUpperCase()}</span>
        <span class="ticker-price">${formatMoney(c.current_price)}</span>
        <span class="ticker-chg ${clrClass}">${sign}${(c.price_change_percentage_24h || 0).toFixed(2)}%</span>
      </div>
    `;
  });
  // Duplicate the elements to allow continuous seamless loop in CSS marquee
  track.innerHTML = items.join("") + items.join("");
}

function renderTabContent(preEnriched = null) {
  const enriched = preEnriched || getEnrichedHoldings();
  const q = document.getElementById("searchInput").value.toLowerCase();

  if (currentTab === "holdings") {
    renderHoldingsTable(enriched, q);
  } else if (currentTab === "trades") {
    renderTradesTable(q);
  } else if (currentTab === "dist") {
    renderDistributions(enriched, q);
  }
}

function renderHoldingsTable(list, q) {
  if (q)
    list = list.filter(
      (h) =>
        h.sym.toLowerCase().includes(q) || h.name.toLowerCase().includes(q),
    );

  if (currentSort === "value") list.sort((a, b) => b.value - a.value);
  if (currentSort === "pnl") list.sort((a, b) => b.pnlPct - a.pnlPct);
  if (currentSort === "24h") list.sort((a, b) => b.change24h - a.change24h);
  if (currentSort === "7d") list.sort((a, b) => b.change7d - a.change7d);

  const thead = document.getElementById("tableHeader");
  thead.innerHTML = `
    <th>ASSET</th>
    <th>BALANCE</th>
    <th>AVG BUY</th>
    <th>CURRENT PRICE</th>
    <th>P&L</th>
    <th>VALUE</th>
    <th>24H</th>
    <th>7D</th>
    <th>ACTIONS</th>
  `;

  const tbody = document.getElementById("tableBody");
  if (!list.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9">
          <div class="empty-portfolio-state">
            <span style="font-size: 40px; display: block; margin-bottom: 10px;">💼</span>
            <h3>Your Portfolio is Empty</h3>
            <p>Connect your exchange keys, add holdings manually, or load a pre-configured demo portfolio to see detailed metrics and performance charts in action.</p>
            <button class="btn btn-primary" id="btnLoadDemoPortfolio" style="font-size:12px; padding:8px 16px; font-weight:700;">✨ Load Demo Portfolio</button>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  const totalVal = list.reduce((s, h) => s + h.value, 0);

  tbody.innerHTML = list
    .map((h) => {
      const pnlCls = h.pnl >= 0 ? "green-text" : "red-text";
      const alloc = totalVal ? ((h.value / totalVal) * 100).toFixed(1) : 0;

      // Choose dynamic image or fallback
      const imgUrl =
        h.image ||
        (window.COINGECKO_LOGO_MAP[h.sym]
          ? window.COINGECKO_LOGO_MAP[h.sym]
          : `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${h.sym.toLowerCase()}.png`);

      // Balance value in rupees
      const balInr = formatMoney(h.value);

      return `
      <tr data-sym="${h.sym}">
        <td>
          <div class="coin-cell">
            <div class="coin-icon">
              <img src="${imgUrl}" alt="${h.sym}" onerror="window.handleAssetLogoError(this, '${escAttr(h.sym)}', false, '')">
              <div class="coin-icon-fallback" style="display:none; width:100%; height:100%; border-radius:50%; background:rgba(0,229,160,0.12); color:#00e5a0; align-items:center; justify-content:center; font-size:0.75rem; font-weight:800; border:1px solid rgba(0,229,160,0.25); font-family:'Syne',sans-serif;">${h.sym.slice(0, 3)}</div>
            </div>
            <div class="coin-name-wrap">
              <div class="coin-name">${h.sym}</div>
              <div class="coin-details">
                <span class="coin-tag">CRYPTO</span>
                <span class="coin-alloc">${alloc}%</span>
              </div>
            </div>
          </div>
        </td>
        <td>
          <div class="balance-amount val-mono">${h.quantity}</div>
          <div class="balance-value val-mono balance-value-val">≈ ${balInr}</div>
        </td>
        <td>
          ${
            h.avgBuy
              ? `
            <div class="val-mono">${formatMoney(h.avgBuy)}</div>
            <div class="cell-subtext">avg buy price</div>
          `
              : `
            <div class="val-mono text-dim">—</div>
            <div class="cell-subtext text-dim2">not set</div>
          `
          }
        </td>
        <td>
          <div class="val-mono live-price-val">${formatMoney(h.livePrice)}</div>
          <div class="cell-subtext">live price</div>
        </td>
        <td>
          <div class="val-mono pnl-val ${pnlCls}">${h.pnl >= 0 ? "+" : ""}${formatMoney(h.pnl)}</div>
          <div class="val-mono pnl-pct-val ${pnlCls}" style="font-size:11px;margin-top:2px">${h.pnlPct >= 0 ? "+" : ""}${h.pnlPct.toFixed(2)}%</div>
        </td>
        <td class="val-mono total-value-val" style="font-weight:700;color:#ffffff;">${formatMoney(h.value)}</td>
        <td>
          <span class="badge val-mono badge-val ${h.change24h >= 0 ? "up" : "down"}">${h.change24h >= 0 ? "+" : ""}${h.change24h.toFixed(2)}%</span>
        </td>
        <td>
          <span class="badge val-mono badge-val ${h.change7d >= 0 ? "up" : "down"}">${h.change7d >= 0 ? "+" : ""}${h.change7d.toFixed(2)}%</span>
        </td>
        <td>
          <div class="action-buttons">
            <button class="btn-action" onclick="openEditHoldingModal(${h.id})" title="Edit Asset">✏️</button>
            <button class="btn-action btn-delete" onclick="delHolding(${h.id})" title="Delete Asset">🗑</button>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");
}

function relativeTime(dateStr) {
  const now = Date.now();
  const d = new Date(dateStr);
  const diff = now - d.getTime();
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderTradesTable(q) {
  let list = [...trades];
  if (q) list = list.filter((t) => t.pair.toLowerCase().includes(q));
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const thead = document.getElementById("tableHeader");
  thead.innerHTML = `
    <th>TIME</th>
    <th>ASSET</th>
    <th>TYPE</th>
    <th>QUANTITY</th>
    <th>PRICE</th>
    <th>TOTAL</th>
    <th>SOURCE</th>
  `;

  const tbody = document.getElementById("tableBody");
  if (!list.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-portfolio-state">
            <span style="font-size: 40px; display: block; margin-bottom: 10px;">📋</span>
            <h3>No Trade History</h3>
            <p>Trades from CoinDCX sync or manual holding changes will appear here.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((t) => {
      const isBuy = t.type.toLowerCase() === "buy";
      const rawSym = t.pair.toUpperCase();
      const sym = rawSym.replace(/^(B-|I-)/, "").replace(/_(INR|USDT|USD|BTC)$/, "").replace(/(INR|USDT|USD|BTC)$/, "");
      const isManual = t.trade_id && t.trade_id.startsWith("manual-");
      const imgUrl =
        window.COINGECKO_LOGO_MAP[sym] ||
        `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${sym.toLowerCase()}.png`;

      return `
      <tr>
        <td>
          <div class="val-mono" style="color:#94a3b8; font-size:13px;">${relativeTime(t.created_at)}</div>
          <div class="cell-subtext">${t.time}</div>
        </td>
        <td>
          <div class="coin-cell">
            <div class="coin-icon">
              <img src="${imgUrl}" alt="${sym}" onerror="window.handleAssetLogoError(this, '${escAttr(sym)}', false, '')">
              <div class="coin-icon-fallback" style="display:none; width:100%; height:100%; border-radius:50%; background:rgba(0,229,160,0.12); color:#00e5a0; align-items:center; justify-content:center; font-size:0.75rem; font-weight:800; border:1px solid rgba(0,229,160,0.25); font-family:'Syne',sans-serif;">${sym.slice(0, 3)}</div>
            </div>
            <div class="coin-name">${sym}</div>
          </div>
        </td>
        <td>
          <span class="badge ${isBuy ? "up" : "down"}" style="font-size:11px; padding:4px 12px;">
            ${isBuy ? "▲ BUY" : "▼ SELL"}
          </span>
        </td>
        <td>
          <div class="val-mono" style="font-size:14px;">${t.qty}</div>
        </td>
        <td>
          <div class="val-mono" style="font-size:14px;">${formatMoney(t.price)}</div>
        </td>
        <td>
          <div class="val-mono" style="color:#ffffff; font-size:14px; font-weight:700;">${formatMoney(t.total)}</div>
        </td>
        <td>
          <span class="badge ${isManual ? "flat" : "up"}" style="font-size:10px; padding:3px 10px;">${isManual ? "✎ MANUAL" : "↻ SYNC"}</span>
        </td>
      </tr>
    `;
    })
    .join("");
}

function renderDistributions(enriched, q) {
  if (q)
    enriched = enriched.filter(
      (h) =>
        h.sym.toLowerCase().includes(q) || h.name.toLowerCase().includes(q),
    );

  // Sort by value
  enriched.sort((a, b) => b.value - a.value);

  const thead = document.getElementById("tableHeader");
  thead.innerHTML = `
    <th colspan="2">ASSET ALLOCATION</th>
  `;

  const tbody = document.getElementById("tableBody");
  if (!enriched.length) {
    tbody.innerHTML =
      '<tr><td class="empty-state">No holdings found.</td></tr>';
    return;
  }

  const totalVal = enriched.reduce((s, h) => s + h.value, 0);

  tbody.innerHTML = `
    <tr>
      <td colspan="2" style="padding: 20px;">
        <div class="dist-container" style="display:flex;flex-direction:column;gap:16px;">
          ${enriched
            .map((h, i) => {
              const alloc = totalVal
                ? ((h.value / totalVal) * 100).toFixed(1)
                : 0;
              // Cycle colors
              const colors = [
                "#00d4aa",
                "#4a9eff",
                "#7b61ff",
                "#f59e0b",
                "#ef4444",
                "#06b6d4",
              ];
              const clr = colors[i % colors.length];
              const imgUrl =
                h.image ||
                window.COINGECKO_LOGO_MAP[h.sym] ||
                `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${h.sym.toLowerCase()}.png`;

              return `
              <div class="dist-item" style="background:#0b0f19;border:1px solid #141c2c;border-radius:10px;padding:14px 18px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                  <div class="coin-cell">
                    <div class="coin-icon" style="width:24px;height:24px;font-size:9px;">
                      <img src="${imgUrl}" alt="${h.sym}" onerror="window.handleAssetLogoError(this, '${escAttr(h.sym)}', false, '')">
                      <div class="coin-icon-fallback" style="display:none; width:100%; height:100%; border-radius:50%; background:rgba(0,229,160,0.12); color:#00e5a0; align-items:center; justify-content:center; font-size:0.6rem; font-weight:800; border:1px solid rgba(0,229,160,0.25); font-family:'Syne',sans-serif;">${h.sym.slice(0, 3)}</div>
                    </div>
                    <div style="font-weight:700;font-size:13px;color:#ffffff;">${h.name} (${h.sym})</div>
                  </div>
                  <div style="text-align:right;">
                    <span class="val-mono" style="color:#00d4aa;font-weight:700;font-size:13px;margin-right:8px;">${alloc}%</span>
                    <span class="val-mono" style="color:#64748b;font-size:12px;">${formatMoney(h.value)}</span>
                  </div>
                </div>
                <div class="dist-bar-track" style="height:6px;background:#141c2c;border-radius:3px;overflow:hidden;">
                  <div class="dist-bar-fill" style="width:${alloc}%;height:100%;background:${clr};border-radius:3px;"></div>
                </div>
              </div>
            `;
            })
            .join("")}
        </div>
      </td>
    </tr>
  `;
}

function renderChart(enriched) {
  if (!enriched || !enriched.length) return;
  const sorted = [...enriched].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 5);
  const othersVal = sorted.slice(5).reduce((s, h) => s + h.value, 0);

  const labels = top.map((t) => t.sym);
  const data = top.map((t) => t.value);
  const colors = ["#7b61ff", "#00d4aa", "#06b6d4", "#f59e0b", "#ec4899"];

  if (othersVal > 0) {
    labels.push("Others");
    data.push(othersVal);
    colors.push("#334155");
  }

  if (weightingsChart) weightingsChart.destroy();

  const canvas = document.getElementById("weightingsChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  weightingsChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: "#0d1220",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "78%",
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(13, 20, 35, 0.95)",
          titleColor: "#ffffff",
          bodyColor: "#94a3b8",
          borderColor: "rgba(255, 255, 255, 0.08)",
          borderWidth: 1,
          padding: 12,
          cornerRadius: 10,
          titleFont: {
            family: "Outfit",
            size: 13,
            weight: "bold"
          },
          bodyFont: {
            family: "Outfit",
            size: 12
          },
          callbacks: {
            label: (ctx) => " " + formatMoney(ctx.raw)
          }
        },
      },
    },
  });

  const totalVal = data.reduce((s, v) => s + v, 0);
  document.getElementById("chartLegend").innerHTML = labels
    .map(
      (l, i) => `
    <div class="legend-item">
      <div class="legend-left">
        <div class="legend-dot" style="background:${colors[i]}"></div>
        <div class="legend-name">${l}</div>
      </div>
      <div class="legend-right">
        <span class="legend-pct">${((data[i] / totalVal) * 100).toFixed(1)}%</span>
        <span class="legend-val val-mono">${formatMoney(data[i])}</span>
      </div>
    </div>
  `,
    )
    .join("");
}

async function delHolding(id) {
  if (!confirm("Delete this holding?")) return;
  try {
    const res = await fetch(`/api/portfolio/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      showToast("Deleted holding.", "success");
      await fetchHoldings();
      await fetchTrades();
      renderAll();
    } else {
      showToast("Failed to delete holding.", "err");
    }
  } catch (e) {
    showToast("Error deleting.", "err");
  }
}

function exportCSV() {
  const rows = ["ASSET,BALANCE,CURRENT_PRICE,VALUE"];
  holdings.forEach((h) => {
    const live = livePrices[h.symbol.toUpperCase()] || { price: 0 };
    rows.push(
      `"${h.symbol}","${h.quantity}","${live.price}","${h.quantity * live.price}"`,
    );
  });
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "portfolio.csv";
  a.click();
}

function formatMoney(val) {
  const p = Number(val);
  if (p == null || isNaN(p) || p === "") return "₹0.00";
  const locale = "en-IN";
  if (p >= 10000)
    return (
      "₹" +
      p.toLocaleString(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    );
  if (p >= 1000)
    return (
      "₹" +
      p.toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  if (p >= 1)
    return (
      "₹" +
      p.toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      })
    );
  if (p > 0) return "₹" + p.toFixed(6);
  if (p < 0) {
    const abs = Math.abs(p);
    if (abs >= 10000)
      return (
        "-₹" +
        abs.toLocaleString(locale, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })
      );
    if (abs >= 1000)
      return (
        "-₹" +
        abs.toLocaleString(locale, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      );
    if (abs >= 1)
      return (
        "-₹" +
        abs.toLocaleString(locale, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        })
      );
    return "-₹" + abs.toFixed(6);
  }
  return "₹0.00";
}

function showToast(msg, type = "info") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.style.display = "block";
  t.style.borderColor = type === "err" ? "#ef4444" : "#00d4aa";
  t.style.color = type === "err" ? "#ef4444" : "#00d4aa";
  setTimeout(() => (t.style.display = "none"), 3000);
}

/* ─── MODERN ANALYTICS & PORTFOLIO EXTENSIONS ─── */
function getCoinGeckoId(symbol) {
  if (!marketsData || !marketsData.length) return null;
  const match = marketsData.find(
    (m) => (m.symbol || "").toUpperCase() === symbol.toUpperCase(),
  );
  return match ? match.id : null;
}

async function loadDemoPortfolio() {
  const demoAssets = [
    { symbol: "BTC", name: "Bitcoin", quantity: 0.18, buy_price: 5420000 },
    { symbol: "ETH", name: "Ethereum", quantity: 2.4, buy_price: 298000 },
    { symbol: "SOL", name: "Solana", quantity: 28.5, buy_price: 11200 },
    { symbol: "XRP", name: "Ripple", quantity: 1500, buy_price: 45 },
  ];

  const btn = document.getElementById("btnLoadDemoPortfolio");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Loading...";
  }

  try {
    for (const asset of demoAssets) {
      await fetch("/api/portfolio", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...asset, asset_type: "crypto" }),
      });
    }
    showToast("Demo portfolio loaded successfully!", "success");
    await fetchHoldings();
    await fetchTrades();
    await fetchLivePrices();
    renderAll();
  } catch (e) {
    console.error(e);
    showToast("Failed to load demo portfolio.", "err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "✨ Load Demo Portfolio";
    }
  }
}

async function renderPerformanceChart() {
  const canvas = document.getElementById("performanceChart");
  if (!canvas) return;

  const enriched = getEnrichedHoldings();
  if (!enriched.length) return;

  const ctx = canvas.getContext("2d");

  const promises = enriched.map(async (h) => {
    const cgId = getCoinGeckoId(h.sym);
    if (!cgId) return null;
    try {
      const res = await fetch(`/api/coins/${cgId}/chart?days=7`);
      if (res.ok) {
        const data = await res.json();
        return {
          symbol: h.sym,
          qty: h.quantity,
          prices: data.prices,
        };
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  });

  const results = (await Promise.all(promises)).filter((r) => r !== null);
  if (!results.length) return;

  // Align timelines
  const baseResult = results.reduce(
    (max, r) => (r.prices.length > max.prices.length ? r : max),
    results[0],
  );
  const basePrices = baseResult.prices;

  const labels = [];
  const values = [];

  basePrices.forEach((point, idx) => {
    const ts = point[0];
    const dateObj = new Date(ts);
    const labelStr = dateObj.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
    labels.push(labelStr);

    let totalVal = 0;
    results.forEach((res) => {
      let price = 0;
      if (res.prices[idx]) {
        price = res.prices[idx][1];
      } else {
        const nearest = res.prices.reduce(
          (prev, curr) =>
            Math.abs(curr[0] - ts) < Math.abs(prev[0] - ts) ? curr : prev,
          res.prices[0],
        );
        price = nearest ? nearest[1] : 0;
      }
      totalVal += res.qty * price;
    });
    values.push(totalVal);
  });

  const firstVal = values[0];
  const lastVal = values[values.length - 1];
  const return7d = firstVal ? ((lastVal - firstVal) / firstVal) * 100 : 0;

  const returnEl = document.getElementById("perfChartReturn");
  if (returnEl) {
    const isUp = return7d >= 0;
    returnEl.textContent = (isUp ? "+" : "") + return7d.toFixed(2) + "% (7d)";
    returnEl.style.color = isUp ? "#00d4aa" : "#f87171";
  }

  if (performanceChartInstance) {
    performanceChartInstance.destroy();
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 220);
  gradient.addColorStop(0, "rgba(123, 97, 255, 0.20)");
  gradient.addColorStop(1, "rgba(123, 97, 255, 0.00)");

  performanceChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Portfolio Value",
          data: values,
          borderColor: "#7b61ff",
          borderWidth: 2,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: "#7b61ff",
          pointHoverBorderColor: "#fff",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: "index",
          intersect: false,
          backgroundColor: "rgba(13, 20, 35, 0.95)",
          titleColor: "#ffffff",
          bodyColor: "#94a3b8",
          borderColor: "rgba(255, 255, 255, 0.08)",
          borderWidth: 1,
          padding: 12,
          cornerRadius: 10,
          titleFont: {
            family: "Outfit",
            size: 13,
            weight: "bold"
          },
          bodyFont: {
            family: "Outfit",
            size: 12
          },
          displayColors: false,
          callbacks: {
            label: (context) => " Value: " + formatMoney(context.raw),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxTicksLimit: 7,
            color: "#64748b",
            font: { family: "Outfit", size: 11 },
          },
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: {
            color: "#64748b",
            font: { family: "Outfit", size: 11 },
            callback: (val) =>
              "₹" +
              Number(val).toLocaleString("en-IN", { maximumFractionDigits: 0 }),
          },
        },
      },
    },
  });
}

function renderAnalytics(enriched) {
  const healthEl = document.getElementById("analyticHealth");
  const divEl = document.getElementById("analyticDiversification");
  const deltaEl = document.getElementById("analyticDelta");
  const exposureEl = document.getElementById("analyticLargestAsset");

  if (!enriched || !enriched.length) {
    if (healthEl) healthEl.textContent = "—";
    if (divEl) divEl.textContent = "—";
    if (deltaEl) deltaEl.textContent = "—";
    if (exposureEl) exposureEl.textContent = "—";
    return;
  }

  const totalVal = enriched.reduce((s, h) => s + h.value, 0);
  const totalPnl = enriched.reduce((s, h) => s + h.pnl, 0);

  // Health State
  if (healthEl) {
    if (totalPnl > 0) {
      healthEl.textContent = "Profit State";
      healthEl.style.color = "#00d4aa";
    } else if (totalPnl < 0) {
      healthEl.textContent = "Drawdown";
      healthEl.style.color = "#f87171";
    } else {
      healthEl.textContent = "Breakeven";
      healthEl.style.color = "#ffffff";
    }
  }

  // Diversification
  if (divEl) {
    const numAssets = enriched.length;
    if (numAssets === 1) {
      divEl.textContent = "Concentrated";
      divEl.style.color = "#f87171";
    } else if (numAssets <= 3) {
      divEl.textContent = "Moderate";
      divEl.style.color = "#fb923c";
    } else {
      divEl.textContent = "Well-Diversified";
      divEl.style.color = "#00d4aa";
    }
  }

  // 24h Absolute Delta
  if (deltaEl) {
    const weighted24h = totalVal
      ? enriched.reduce((s, h) => s + h.change24h * (h.value / totalVal), 0)
      : 0;
    const absChange = totalVal * (weighted24h / 100);
    const sign = absChange >= 0 ? "+" : "";
    deltaEl.textContent = `${sign}${formatMoney(absChange)} (${sign}${weighted24h.toFixed(2)}%)`;
    deltaEl.style.color = absChange >= 0 ? "#00d4aa" : "#f87171";
  }

  // Primary exposure
  if (exposureEl) {
    const sorted = [...enriched].sort((a, b) => b.value - a.value);
    const top = sorted[0];
    const topAlloc = totalVal ? ((top.value / totalVal) * 100).toFixed(1) : 0;
    exposureEl.textContent = `${top.sym} (${topAlloc}%)`;
    exposureEl.style.color = "#ffffff";
  }
}

function initRealtimeUpdates() {
  if (typeof io === "undefined") {
    console.warn("[portfolio] Socket.io client not loaded. Live ticks disabled.");
    return;
  }
  const socket = io({ reconnectionAttempts: 20, reconnectionDelay: 1000 });
  socket.on("connect_error", () => {
    console.warn("[portfolio] Socket.IO connection lost. Falling back to polling.");
    fetchLivePrices();
  });
  socket.on("reconnect", () => {
    console.log("[portfolio] Socket.IO reconnected. Resuming live ticks.");
    fetchLivePrices();
  });
  socket.on("tickerUpdate", (data) => {
    if (!data || !data.symbol) return;
    const sym = data.symbol.toUpperCase();

    // ── Update live INR price ───────────────────────────────────────────
    // Use premiumMultiplier (CoinDCX_INR / Binance_USD ratio) to convert
    // the live Binance USD ticker to INR.  Recalibrated every poll by
    // setting premiumMultiplier to undefined so the next ticker recomputes
    // it against the fresh CoinDCX baseline.
    if (data.price > 0) {
      if (_refreshedByPoll.has(sym) && livePrices[sym]) {
        livePrices[sym].premiumMultiplier = undefined;
      }

      if (livePrices[sym]) {
        const oldPrice = livePrices[sym].price || 0;
        if (!livePrices[sym].premiumMultiplier) {
          livePrices[sym].premiumMultiplier =
            oldPrice > 0 && oldPrice !== data.price
              ? oldPrice / data.price
              : usdInrRate;
        }
        livePrices[sym].price = data.price * livePrices[sym].premiumMultiplier;
      } else {
        livePrices[sym] = {
          price: data.price * usdInrRate,
          change: data.changePercent || 0,
          change7d: 0,
          image: null,
          premiumMultiplier: usdInrRate,
        };
      }
    }

    if (data.changePercent != null && livePrices[sym]) {
      livePrices[sym].change = data.changePercent;
    }

    const currentPrice = livePrices[sym]?.price || data.price * usdInrRate;

    // ── Ticker carousel ──────────────────────────────────────────────────
    const track = document.getElementById("tickerTrack");
    if (track) {
      const tickerItems = track.querySelectorAll(".ticker-item");
      tickerItems.forEach((item) => {
        const symEl = item.querySelector(".ticker-sym");
        if (symEl && symEl.textContent.trim().toUpperCase() === sym) {
          const priceEl = item.querySelector(".ticker-price");
          const chgEl = item.querySelector(".ticker-chg");

          if (priceEl) priceEl.textContent = formatMoney(currentPrice);
          if (chgEl && data.changePercent != null) {
            const isUp = data.changePercent >= 0;
            chgEl.textContent = (isUp ? "+" : "") + data.changePercent.toFixed(2) + "%";
            chgEl.className = "ticker-chg " + (isUp ? "up" : "down");
          }

          item.classList.remove("pulse-update");
          void item.offsetWidth;
          item.classList.add("pulse-update");
        }
      });
    }

    const row = document.querySelector(`tr[data-sym="${sym}"]`);
    if (row) {
      const priceVal = livePrices[sym]?.price || data.price * usdInrRate;

      // Read quantity from holdings array (not DOM)
      const h = holdings.find((item) => item.symbol.toUpperCase() === sym);
      const qty = h ? h.quantity : 0;
      const value = qty * priceVal;

      const priceEl = row.querySelector(".live-price-val");
      const totalValueEl = row.querySelector(".total-value-val");
      const balanceValueEl = row.querySelector(".balance-value-val");
      const pnlEl = row.querySelector(".pnl-val");
      const pnlPctEl = row.querySelector(".pnl-pct-val");

      if (priceEl) {
        priceEl.textContent = formatMoney(priceVal);
        priceEl.classList.remove("pulse-update");
        void priceEl.offsetWidth;
        priceEl.classList.add("pulse-update");
      }
      if (totalValueEl) totalValueEl.textContent = formatMoney(value);
      if (balanceValueEl) balanceValueEl.textContent = "≈ " + formatMoney(value);

      if (h) {
        const avg = h.buy_price > 0 ? h.buy_price : null;
        const costBasis = avg || priceVal;
        const pnl = (priceVal - costBasis) * h.quantity;
        const pnlPct = costBasis ? ((priceVal - costBasis) / costBasis) * 100 : 0;
        const pnlCls = pnl >= 0 ? "green-text" : "red-text";

        if (pnlEl) {
          pnlEl.textContent = (pnl >= 0 ? "+" : "") + formatMoney(pnl);
          pnlEl.className = "val-mono pnl-val " + pnlCls;
        }
        if (pnlPctEl) {
          pnlPctEl.textContent = (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(2) + "%";
          pnlPctEl.className = "val-mono pnl-pct-val " + pnlCls;
        }
      }

      if (data.changePercent != null) {
        const badgeEl = row.querySelector(".badge-val");
        if (badgeEl) {
          badgeEl.textContent = (data.changePercent >= 0 ? "+" : "") + data.changePercent.toFixed(2) + "%";
          badgeEl.className = "badge val-mono badge-val " + (data.changePercent >= 0 ? "up" : "down");
        }
      }
      
      if (_initialLoadComplete) {
        const enriched = getEnrichedHoldings();
        renderCards(enriched);
        renderAnalytics(enriched);
      }
    }
  });
}

function initSpotlightGlows() {
  const pageWrap = document.querySelector(".page-wrap") || document.body;
  pageWrap.addEventListener("mousemove", (e) => {
    if (!e.target || typeof e.target.closest !== "function") return;
    const card = e.target.closest(".kpi");
    if (card) {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty("--mouse-x", `${x}px`);
      card.style.setProperty("--mouse-y", `${y}px`);
    }
  });
}

async function getUsdInrRate() {
  try {
    const res = await fetch("/api/rates", { credentials: "include" });
    const j = await res.json();
    if (j && j.usd_inr) {
      usdInrRate = j.usd_inr;
    }
  } catch (e) {
    console.error("Error fetching USD/INR rate:", e);
  }
}

// Expose functions globally for inline HTML click handlers
(window as any).openAddEditHoldingForMissing = openAddEditHoldingForMissing;
(window as any).openEditHoldingModal = openEditHoldingModal;
(window as any).delHolding = delHolding;
}
