"use strict";
// @ts-nocheck
// ═══════════════════════════════════════════════════════════════
//  STOCKWISE — Live Tracker
//  track: coins or stocks, sparklines, chart modals, alerts
// ═══════════════════════════════════════════════════════════════
(function () {
    "use strict";
    // ─── STATE ───────────────────────────────────────────────────
    let allCoins = [];
    let allStocks = [];
    let chartInstance = null;
    let currentCoinId = "";
    let currentSort = "mcap";
    let favMode = false;
    let currentType = "all";
    let currentCryptoCategory = "";
    let currentStockCategory = "all";
    let favSet = JSON.parse(localStorage.getItem("sw_favs") || "[]");
    let lastQueriedChartCoin = null;
    let currentViewMode = localStorage.getItem("sw_layout") || "grid";
    let displayedCount = 16;
    let fetchedBuyPrices = new Set();
    let observerInstance = null;
    const _refreshedCoins = new Set();
    // Buy-price cache: keyed by `${vs_currency}:${symbolsHash}`, TTL 60s
    let buyPriceCache = { data: null, timestamp: 0, key: "" };
    const BUY_PRICE_CACHE_TTL = 60000;
    // Websocket-supported symbols for live heartbeat pulses
    const WS_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "DOGE", "MATIC", "LINK", "NEAR", "ARB"];
    // Indicator state tracking
    let activeIndicators = {
        ohlc: false,
        sma: false,
        ema: false,
        rsi: false,
        bb: false,
        volume: false,
    };
    let indicatorPeriods = { sma: 20, ema: 20, rsi: 14, bb: 20 };
    // Live USD→INR rate for consistent INR pricing (derived from USDT)
    let usdInrRate = 95.3;
    let usdInrRateTime = 0;
    // ─── DOM HELPER ──────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);
    // ─── COINGECKO CATEGORY MAP ─────────────────────────────────
    const CATEGORY_MAP = {
        all: "",
        hot: "trending",
        trending: "trending",
        defi: "decentralized-finance-defi",
        "decentralized-finance-defi": "decentralized-finance-defi",
        meme: "meme-token",
        "meme-token": "meme-token",
        "meme-tokens": "meme-token",
        "meme coin": "meme-token",
        nft: "non-fungible-tokens-nft",
        "layer-1": "layer-1",
        layer1: "layer-1",
        "layer-2": "layer-2",
        layer2: "layer-2",
        gaming: "gaming",
        exchange: "exchange-tokens",
        "exchange token": "exchange-tokens",
        privacy: "privacy-coins",
        "smart-contract": "smart-contract-platforms",
        "smart contract": "smart-contract-platforms",
        stablecoins: "stablecoins",
        stablecoin: "stablecoins",
        "artificial-intelligence": "artificial-intelligence",
        ai: "artificial-intelligence",
    };
    function resolveCat(raw) {
        const key = String(raw || "")
            .trim()
            .toLowerCase();
        if (CATEGORY_MAP[key] !== undefined)
            return CATEGORY_MAP[key];
        for (const [k, v] of Object.entries(CATEGORY_MAP)) {
            if (k === key || k === key + "s" || k + "s" === key)
                return v;
        }
        return raw;
    }
    async function getUsdInrRate(force = false) {
        const now = Date.now();
        if (!force && usdInrRateTime && now - usdInrRateTime < 60000)
            return usdInrRate;
        try {
            const r = await fetch("/api/rates", { credentials: "include" });
            const j = await r.json();
            if (j && j.usd_inr) {
                usdInrRate = j.usd_inr;
                usdInrRateTime = now;
            }
        }
        catch { }
        return usdInrRate;
    }
    function renderShimmer() {
        const el = $("shimmerGrid");
        if (!el)
            return;
        el.innerHTML = Array(9)
            .fill(0)
            .map(() => '<div class="skel-card skel-block"></div>')
            .join("");
    }
    function showShimmer() {
        const sg = $("shimmerGrid");
        const cg = $("coinsGrid");
        // Only show shimmer if grid is completely empty (first load)
        if (cg && cg.innerHTML.trim() === "") {
            if (sg)
                sg.style.display = "grid";
            if (cg)
                cg.style.display = "none";
            renderShimmer();
        }
        else {
            if (cg)
                cg.classList.add("loading");
        }
    }
    function hideShimmerAndShowGrid() {
        const sg = $("shimmerGrid");
        if (sg)
            sg.style.display = "none";
        const cg = $("coinsGrid");
        if (cg) {
            cg.style.display = currentViewMode === "list" ? "flex" : "grid";
            cg.classList.remove("loading");
        }
    }
    async function loadPrices(category, forceFresh = false) {
        showShimmer();
        try {
            const currency = $("currencySelect")?.value || "usd";
            let data;
            let vs = currency === "usdt" ? "usd" : currency;
            const rawCat = category ?? currentCryptoCategory ?? "";
            const cat = resolveCat(rawCat);
            const queryParams = new URLSearchParams({
                per_page: 250,
                order: "market_cap_desc",
                sparkline: "false",
                price_change_percentage: "1h,24h,7d",
                vs_currency: vs,
            });
            if (cat)
                queryParams.set("category", cat);
            if (forceFresh)
                queryParams.set("fresh", "1");
            const cgUrl = `/api/markets?${queryParams.toString()}`;
            let dcxUrl = null;
            if (currency === "inr" || currency === "usdt" || currency === "usd") {
                const dcxParams = new URLSearchParams({
                    vs_currency: currency === "usdt" ? "usdt" : currency === "usd" ? "usd" : "inr",
                });
                if (forceFresh)
                    dcxParams.set("fresh", "1");
                dcxUrl = `/api/coindcx/markets?${dcxParams.toString()}`;
            }
            // Fetch base listings and ticker data in parallel
            const fetchPromises = [fetch(cgUrl, { credentials: "include" })];
            if (dcxUrl) {
                fetchPromises.push(fetch(dcxUrl, { credentials: "include" }));
            }
            const responses = await Promise.all(fetchPromises);
            const cgRes = responses[0];
            const dcxRes = responses[1];
            data = await cgRes.json();
            if (data.error)
                throw new Error(data.error);
            if (!Array.isArray(data))
                throw new Error("Malformed response");
            // Render CoinGecko data immediately — don't wait for CoinDCX merge
            allCoins = data;
            _refreshedCoins.clear();
            fetchedBuyPrices.clear();
            buyPriceCache = { data: null, timestamp: 0, key: "" };
            updateLastRefresh();
            await getUsdInrRate();
            filterTable();
            // Merge CoinDCX pricing in background (non-blocking)
            if (dcxRes) {
                try {
                    const dcxData = await dcxRes.json();
                    if (Array.isArray(dcxData)) {
                        const dcxMap = {};
                        dcxData.forEach((d) => {
                            if (d.symbol)
                                dcxMap[d.symbol.toUpperCase()] = d;
                        });
                        allCoins = allCoins.map((coin) => {
                            const sym = (coin.symbol || "").toUpperCase();
                            const dcx = dcxMap[sym];
                            if (dcx && dcx.current_price != null) {
                                _refreshedCoins.add(sym);
                                return {
                                    ...coin,
                                    current_price: dcx.current_price,
                                    price_change_percentage_24h: dcx.price_change_percentage_24h ??
                                        coin.price_change_percentage_24h,
                                    total_volume: dcx.total_volume || coin.total_volume,
                                    premium_multiplier: undefined,
                                };
                            }
                            return coin;
                        });
                        filterTable();
                    }
                }
                catch (mergeErr) {
                    console.warn("[tracker] CoinDCX merge error:", mergeErr?.message || mergeErr);
                }
            }
        }
        catch (err) {
            console.error("[markets]", err);
            const sg = $("shimmerGrid");
            if (sg) {
                sg.innerHTML = `
          <div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--red)">
            ⚠ Failed to load prices — ${escHtml(err.message)}.
            <button class="cbtn" onclick="loadPrices('${escAttr(currentCryptoCategory || "")}')" style="margin-top:0.75rem">Retry</button>
          </div>`;
            }
        }
    }
    async function loadStocks(category, forceFresh = false) {
        showShimmer();
        try {
            const cat = (category ?? currentStockCategory) || "all";
            let url = `/api/stocks?category=${encodeURIComponent(cat)}`;
            if (forceFresh)
                url += "&fresh=1";
            const res = await fetch(url, { credentials: "include" });
            const data = await res.json();
            if (!Array.isArray(data))
                throw new Error("Malformed response");
            allStocks = data;
            updateLastRefresh();
            await getUsdInrRate();
            filterTable();
        }
        catch (err) {
            console.error("[stocks]", err);
            const sg = $("shimmerGrid");
            if (sg) {
                sg.innerHTML = `
          <div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--red)">
            ⚠ Failed to load stocks — ${escHtml(err.message)}.
            <button class="cbtn" onclick="loadStocks('${escAttr(currentStockCategory || "all")}')" style="margin-top:0.75rem">Retry</button>
          </div>`;
            }
        }
    }
    function updateLastRefresh() {
        const el = $("lastUpdate");
        if (el)
            el.textContent = new Date().toLocaleTimeString();
    }
    function updateCategoryBar(type) {
        const cb = $("categoryBar");
        if (cb) {
            if (type === "all") {
                cb.classList.remove("open");
            }
            else {
                cb.classList.add("open");
            }
        }
        const cc = $("cryptoCats");
        if (cc)
            cc.style.display = type === "crypto" ? "inline-flex" : "none";
        const sc = $("stockCats");
        if (sc)
            sc.style.display = type === "stock" ? "inline-flex" : "none";
    }
    function switchType(type, btn) {
        currentType = type;
        document
            .querySelectorAll(".view-btn")
            .forEach((b) => b.classList.remove("active"));
        btn?.classList.add("active");
        updateCategoryBar(type);
        if (type === "stock") {
            loadStocks(currentStockCategory);
        }
        else if (type === "crypto") {
            loadPrices(currentCryptoCategory);
        }
        else {
            loadAll();
        }
    }
    function changeCryptoCategory(rawCat, btn) {
        const resolved = resolveCat(rawCat);
        currentCryptoCategory = resolved;
        document
            .querySelectorAll("#cryptoCats .cat-pill")
            .forEach((b) => b.classList.remove("active"));
        btn?.classList.add("active");
        loadPrices(resolved);
    }
    function changeStockCategory(cat, btn) {
        currentStockCategory = cat;
        document
            .querySelectorAll("#stockCats .cat-pill")
            .forEach((b) => b.classList.remove("active"));
        btn?.classList.add("active");
        loadStocks(cat);
    }
    function setSort(mode, btn) {
        currentSort = mode;
        document
            .querySelectorAll(".sort-btn")
            .forEach((b) => b.classList.remove("active"));
        btn?.classList.add("active");
        filterTable();
    }
    function sortCoins(coins) {
        return [...coins].sort((a, b) => {
            switch (currentSort) {
                case "gainers":
                    return ((b.price_change_percentage_24h || 0) -
                        (a.price_change_percentage_24h || 0));
                case "losers":
                    return ((a.price_change_percentage_24h || 0) -
                        (b.price_change_percentage_24h || 0));
                case "volume":
                    return (b.total_volume || 0) - (a.total_volume || 0);
                case "mcap":
                    return (b.market_cap || 0) - (a.market_cap || 0);
                default:
                    return 0;
            }
        });
    }
    function toggleFavMode() {
        favMode = !favMode;
        const el = $("favToggle");
        if (el)
            el.classList.toggle("active", favMode);
        filterTable();
    }
    function updateWatchlistCount() {
        const el = $("sStatWatch");
        if (el)
            el.textContent = favSet.length;
    }
    function toggleFav(sym, btnEl) {
        sym = String(sym).toUpperCase();
        const idx = favSet.indexOf(sym);
        if (idx === -1) {
            favSet.push(sym);
        }
        else {
            favSet.splice(idx, 1);
        }
        localStorage.setItem("sw_favs", JSON.stringify(favSet));
        updateWatchlistCount();
        // Immediately update the visual state of the clicked star button
        const isFaved = favSet.includes(sym);
        // Find the button by data-sym attribute or re-query
        const allBtns = document.querySelectorAll(`.fav-trig[data-sym="${sym}"]`);
        allBtns.forEach((b) => {
            b.classList.toggle("on", isFaved);
            const path = b.querySelector("path");
            if (path)
                path.setAttribute("fill", isFaved ? "#ffd43b" : "currentColor");
        });
        // Also update card's is-fav class
        document.querySelectorAll(`.cr[data-sym="${sym}"]`).forEach((card) => {
            card.classList.toggle("is-fav", isFaved);
        });
        if (favMode)
            filterTable();
    }
    function isFav(sym) {
        return favSet.includes(sym);
    }
    function sparkPath(points, w, h) {
        if (!points?.length)
            return "";
        const mn = Math.min(...points), mx = Math.max(...points);
        const rng = mx - mn || 1;
        const step = w / (points.length - 1 || 1);
        return points
            .map((p, i) => {
            const x = i * step;
            const y = h - ((p - mn) / rng) * h;
            return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)} `;
        })
            .join("")
            .trim();
    }
    function sparkColor(chg) {
        if (chg > 0)
            return "rgba(0,229,160,0.7)";
        if (chg < 0)
            return "rgba(255,71,87,0.7)";
        return "rgba(255,255,255,0.3)";
    }
    function filterTable(resetPagination = true) {
        if (resetPagination === true) {
            displayedCount = 16;
        }
        const q = ($("searchInput")?.value || "").toLowerCase().trim();
        let coins;
        if (currentType === "stock") {
            coins = allStocks.filter((c) => c.name.toLowerCase().includes(q) ||
                c.symbol.toLowerCase().includes(q));
        }
        else {
            coins = allCoins.filter((c) => c.name.toLowerCase().includes(q) ||
                c.symbol.toLowerCase().includes(q));
            if (currentType === "all") {
                coins.push(...allStocks.filter((c) => c.name.toLowerCase().includes(q) ||
                    c.symbol.toLowerCase().includes(q)));
            }
        }
        if (favMode)
            coins = coins.filter((c) => isFav(c.symbol.toUpperCase()));
        coins = sortCoins(coins);
        const totalCount = coins.length;
        const visibleCoins = coins.slice(0, displayedCount);
        renderTable(visibleCoins, totalCount);
        setupScrollObserver(totalCount);
        fetchBuyPricesForCoins(visibleCoins);
    }
    function setupScrollObserver(totalCount) {
        const sentinel = $("scrollSentinel");
        const loader = $("sentinelLoader");
        if (!sentinel)
            return;
        if (observerInstance) {
            observerInstance.disconnect();
            observerInstance = null;
        }
        if (displayedCount >= totalCount) {
            if (loader)
                loader.style.display = "none";
            return;
        }
        observerInstance = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting && displayedCount < totalCount) {
                    if (loader)
                        loader.style.display = "flex";
                    setTimeout(() => {
                        if (displayedCount < totalCount) {
                            displayedCount += 16;
                            filterTable(false);
                        }
                    }, 250);
                }
            });
        }, {
            rootMargin: "150px"
        });
        observerInstance.observe(sentinel);
    }
    async function fetchBuyPricesForCoins(coinsSlice) {
        const currency = $("currencySelect")?.value || "usd";
        if (currency !== "inr" && currency !== "usdt" && currency !== "usd")
            return;
        const now = Date.now();
        const cacheKey = `${currency}:${coinsSlice.map(c => c.symbol || "").join(",")}`;
        if (buyPriceCache.key === cacheKey && now - buyPriceCache.timestamp < BUY_PRICE_CACHE_TTL) {
            return; // Cache hit — skip fetch
        }
        const cryptoSymbols = coinsSlice
            .filter((c) => {
            const isItemStock = [
                "nifty50",
                "next50",
                "midcap",
                "smallcap",
            ].includes(c.category);
            return !isItemStock;
        })
            .map((c) => (c.symbol || "").toUpperCase())
            .filter(Boolean)
            .filter((sym) => !fetchedBuyPrices.has(sym));
        if (cryptoSymbols.length === 0)
            return;
        cryptoSymbols.forEach((sym) => fetchedBuyPrices.add(sym));
        const buyVs = currency === "usdt" ? "USDT" : currency === "usd" ? "USD" : "INR";
        const buyParams = new URLSearchParams({
            vs_currency: buyVs,
            symbols: cryptoSymbols.join(","),
        });
        try {
            const buyRes = await fetch(`/api/coindcx/buy-prices?${buyParams.toString()}`, { credentials: "include" });
            const buyData = await buyRes.json();
            if (Array.isArray(buyData)) {
                const buyMap = {};
                buyData.forEach((r) => {
                    if (r?.symbol && r.buy_price != null)
                        buyMap[r.symbol.toUpperCase()] = r.buy_price;
                });
                allCoins = allCoins.map((coin) => {
                    const sym = (coin.symbol || "").toUpperCase();
                    if (buyMap[sym] != null) {
                        _refreshedCoins.add(sym);
                        return {
                            ...coin,
                            current_price: buyMap[sym],
                            coindcx_buy_price: buyMap[sym],
                        };
                    }
                    return coin;
                });
                // Update cache
                buyPriceCache = { data: buyData, timestamp: now, key: cacheKey };
                buyData.forEach((r) => {
                    if (r?.symbol && r.buy_price != null) {
                        const sym = r.symbol.toUpperCase();
                        const card = document.querySelector(`.cr[data-sym="${sym}"]`);
                        if (card) {
                            const priceEl = card.querySelector(".cr-price");
                            if (priceEl) {
                                const pfx = currency === "inr" ? "₹" : currency === "usdt" ? "₮" : "$";
                                priceEl.textContent = pfx + fmtPrice(r.buy_price, currency);
                            }
                        }
                    }
                });
            }
        }
        catch (e) {
            console.warn("[buy-price] background override failed:", e?.message || e);
            cryptoSymbols.forEach((sym) => fetchedBuyPrices.delete(sym));
        }
    }
    function renderSparklineSvg(points, w, h, sym, isPositive) {
        if (!points || !points.length) {
            return `<svg class="ct-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="opacity:.2" role="img"><line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="var(--text2)" stroke-width="1" stroke-dasharray="3,3"/></svg>`;
        }
        const pathData = sparkPath(points, w, h);
        if (!pathData)
            return "";
        const gradId = `spark-grad-${sym.toLowerCase()}`;
        const color = isPositive ? "var(--green)" : "var(--red)";
        const stopColor = isPositive ? "0, 229, 160" : "255, 71, 87";
        return `
      <svg class="ct-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block;width:100%;height:100%;">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(${stopColor}, 0.2)" stop-opacity="1"/>
            <stop offset="100%" stop-color="rgba(${stopColor}, 0)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${pathData} L${w},${h} L0,${h} Z" fill="url(#${gradId})" stroke="none" />
        <path d="${pathData}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
      </svg>
    `;
    }
    function renderTable(coins, totalCount = coins.length) {
        const grid = $("coinsGrid");
        if (!grid) {
            console.warn("[tracker] #coinsGrid missing, retrying");
            setTimeout(filterTable, 200);
            return;
        }
        // Set Layout Mode class
        grid.className = currentViewMode === "list" ? "coins-grid list-mode" : "coins-grid";
        hideShimmerAndShowGrid();
        if (!coins.length) {
            grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:2.5rem;color:var(--text2);font-size:0.92rem">${favMode ? "No assets in your Watchlist yet — click ★ on any card." : "No results found."}</div>`;
            const cc = $("coinCount");
            if (cc)
                cc.textContent = "0 assets";
            return;
        }
        const currency = $("currencySelect")?.value || "usd";
        grid.innerHTML = coins
            .map((c) => {
            const sym = (c.symbol || "").toUpperCase();
            const isItemStock = [
                "nifty50",
                "next50",
                "midcap",
                "smallcap",
            ].includes(c.category);
            let rawPrice = c.current_price ?? 0;
            let rawMcap = c.market_cap ?? 0;
            let rawVol = c.total_volume ?? 0;
            let src = c.sparkline_in_7d?.price;
            if (isItemStock && (currency === "usd" || currency === "usdt")) {
                rawPrice = rawPrice / usdInrRate;
                rawMcap = rawMcap / usdInrRate;
                rawVol = rawVol / usdInrRate;
                if (Array.isArray(src)) {
                    src = src.map((p) => p / usdInrRate);
                }
            }
            const h1 = c.price_change_percentage_1h_in_currency ?? 0;
            const h24 = c.price_change_percentage_24h ?? 0;
            const h7 = c.price_change_percentage_7d_in_currency ?? 0;
            const price = fmtPrice(rawPrice, currency);
            const pfx = currency === "inr" ? "₹" : currency === "usdt" ? "₮" : "$";
            const sign24 = h24 > 0 ? "+" : "";
            const clsPill = h24 === 0 ? "ct-neutral" : h24 > 0 ? "ct-up" : "ct-down";
            const mcap = fmtM(rawMcap, currency);
            const vol = fmtM(rawVol, currency);
            const fav = isFav(sym);
            const coinId = escAttr(c.id || "");
            const coinName = escAttr(c.name || "");
            const img = (window.COINGECKO_LOGO_MAP && window.COINGECKO_LOGO_MAP[sym]) ||
                (c.image
                    ? escAttr(c.image)
                    : `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${sym.toLowerCase()}.png`);
            const onerrorHandler = `window.handleAssetLogoError(this, '${sym}', ${isItemStock}, '${escAttr(c.domain || "")}')`;
            const SW = 80;
            const SH = 30;
            const spark = renderSparklineSvg(src, SW, SH, sym, h24 >= 0);
            const chg1Cls = h1 === 0 ? "neutral" : h1 > 0 ? "positive" : "negative";
            const chg24Cls = h24 === 0 ? "neutral" : h24 > 0 ? "positive" : "negative";
            const chg7Cls = h7 === 0 ? "neutral" : h7 > 0 ? "positive" : "negative";
            // Asset change classes for ambient glows
            const statusCls = h24 === 0 ? "is-neutral" : h24 > 0 ? "is-up" : "is-down";
            const isLive = WS_SYMBOLS.includes(sym);
            const liveDot = isLive ? `<span class="live-pulse-dot" title="Live WebSocket updates active"></span>` : "";
            return `
        <div class="cr ${statusCls}${fav ? " is-fav" : ""}" role="row" tabindex="0" title="${escAttr(c.name)} (${sym})" data-sym="${sym}">
          <div class="cr-top">
            <div class="cr-asset">
              <div class="cr-icon-wrap" style="position:relative; width:48px; height:48px; flex-shrink:0;">
                <img class="cr-icon" src="${img}" alt="${sym}" loading="lazy" onerror="${onerrorHandler}" style="width:48px; height:48px; border-radius:50%; object-fit:cover; display:block;">
                <div class="cr-icon-fallback" style="display:none; width:48px; height:48px; border-radius:50%; background:rgba(0,229,160,0.12); color:#00e5a0; align-items:center; justify-content:center; font-size:0.85rem; font-weight:800; border:1px solid rgba(0,229,160,0.25); font-family:'Syne',sans-serif;">${sym.slice(0, 3)}</div>
              </div>
              <div class="cr-name-box">
                <div class="cr-name">${escHtml(c.name)}</div>
                <div class="cr-symbol" style="display:flex;align-items:center;gap:0.35rem">${sym} ${liveDot}</div>
              </div>
            </div>
            <button class="fav-trig${fav ? " on" : ""}" data-sym="${sym}" onclick="event.stopPropagation();toggleFav('${sym}',this)" title="${fav ? "Remove from Watchlist" : "Add to Watchlist"}" aria-label="Watchlist ${sym}" style="background:none;border:none;cursor:pointer;padding:6px;border-radius:8px;color:var(--text2);transition:all .2s">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="display:block">
                <path fill="${fav ? "#ffd43b" : "currentColor"}" d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </button>
          </div>
          <div class="cr-price-box">
            <div class="cr-price-label">Price</div>
            <div class="cr-price" onclick="openChartModal('${coinId}','${coinName}')" style="cursor:pointer;transition:color .2s" title="Click to view chart">${pfx}${price}</div>
            </div>
            <div class="cr-chg-row" style="position:relative;z-index:1">
              <div class="chg-box"><div class="lbl">1H</div><div class="val ${chg1Cls}">${h1 > 0 ? "+" : ""}${h1.toFixed(2)}%</div></div>
              <div class="chg-box"><div class="lbl">24H</div><div class="val ${chg24Cls}">${sign24}${h24.toFixed(2)}%</div></div>
              <div class="chg-box"><div class="lbl">7D</div><div class="val ${chg7Cls}">${h7 > 0 ? "+" : ""}${h7.toFixed(2)}%</div></div>
            </div>
            <div class="cr-stats-row" style="position:relative;z-index:1">
              <div class="stat-box" title="Market Capitalization"><span class="lbl">MCap</span><span class="val">${mcap}</span></div>
              <div class="stat-box" title="24h Trading Volume"><span class="lbl">Volume</span><span class="val">${vol}</span></div>
            </div>
            <div class="cr-spark-wrap">${spark}</div>
            <div class="cr-actions" style="position:relative;z-index:2">
              <button class="cr-act-btn" onclick="event.stopPropagation();openAlertModal('${sym}',${rawPrice || 0})" title="Set price alert">🔔 Alert</button>
              <button class="cr-act-btn" onclick="event.stopPropagation();openChartModal('${coinId}','${coinName}')" title="View detailed chart">📊 Chart</button>
            </div>
          </div>`;
        })
            .join("");
        const cc = $("coinCount");
        if (cc)
            cc.textContent = `${totalCount} assets`;
    }
    window.$$refreshTicker = () => { };
    function calcSMA(prices, period = 20) {
        const sma = [];
        for (let i = 0; i < prices.length; i++) {
            sma.push(i < period - 1
                ? null
                : prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) /
                    period);
        }
        return sma;
    }
    function calcEMA(prices, period = 20) {
        const k = 2 / (period + 1);
        let prev = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
        const ema = [prev];
        for (let i = period; i < prices.length; i++) {
            prev = prices[i] * k + prev * (1 - k);
            ema.push(prev);
        }
        return ema;
    }
    function calcRSI(prices, period = 14) {
        const rsi = [];
        let gains = 0, losses = 0;
        for (let i = 1; i < prices.length; i++) {
            const d = prices[i] - prices[i - 1];
            gains += d > 0 ? d : 0;
            losses += d < 0 ? -d : 0;
            if (i >= period) {
                rsi.push(100 - 100 / (1 + (gains / losses || 0)));
                const pv = prices[i - period + 1] - prices[i - period];
                gains -= pv > 0 ? pv : 0;
                losses += pv < 0 ? -pv : 0;
            }
        }
        return rsi;
    }
    function calcBollingerBands(prices, period = 20, stdDev = 2) {
        const upper = [], middle = [], lower = [];
        for (let i = 0; i < prices.length; i++) {
            if (i < period - 1) {
                upper.push(null);
                middle.push(null);
                lower.push(null);
            }
            else {
                const slice = prices.slice(i - period + 1, i + 1);
                const avg = slice.reduce((a, b) => a + b, 0) / period;
                const variance = slice.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / period;
                const std = Math.sqrt(variance);
                middle.push(avg);
                upper.push(avg + stdDev * std);
                lower.push(avg - stdDev * std);
            }
        }
        return { upper, middle, lower };
    }
    function calcOHLC(prices, groupSize = 24) {
        const ohlc = [];
        const period = Math.max(1, groupSize | 0);
        for (let i = 0; i < prices.length; i += period) {
            const slice = prices.slice(i, Math.min(i + period, prices.length));
            if (slice.length === 0)
                continue;
            ohlc.push({
                open: slice[0],
                high: Math.max(...slice),
                low: Math.min(...slice),
                close: slice[slice.length - 1],
            });
        }
        return ohlc;
    }
    async function loadChart() {
        if (!lastQueriedChartCoin)
            return;
        const currency = $("chartCurrency")?.value || "usd";
        const vsCurr = currency === "usdt" ? "usd" : currency;
        const range = $("chartRange")?.value || "7";
        const isStock = currentType === "stock";
        const url = isStock
            ? `/api/stocks/${lastQueriedChartCoin}/chart?days=${range}`
            : `/api/coins/${lastQueriedChartCoin}/chart?days=${range}&currency=${vsCurr}`;
        try {
            const res = await fetch(url);
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data.prices?.length)
                throw new Error("No chart data");
            let prices = data.prices.map((p) => p[1]);
            if (isStock && (currency === "usd" || currency === "usdt")) {
                prices = prices.map((p) => p / usdInrRate);
            }
            if (!isStock && prices.length > 0) {
                const currentCoin = allCoins.find((c) => (c.id && c.id === lastQueriedChartCoin) ||
                    (c.symbol && c.symbol.toLowerCase() === lastQueriedChartCoin));
                if (currentCoin && currentCoin.current_price != null) {
                    const lastChartPrice = prices[prices.length - 1];
                    if (lastChartPrice > 0) {
                        const ratio = currentCoin.current_price / lastChartPrice;
                        for (let i = 0; i < prices.length; i++)
                            prices[i] *= ratio;
                    }
                }
            }
            const timestamps = data.prices.map((p) => p[0]);
            const volumes = (data.total_volumes || []).map((v) => v[1]);
            const r = parseInt(range, 10) || 7;
            const labels = timestamps.map((ts) => {
                const d = new Date(ts);
                if (r <= 1)
                    return d.toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: true,
                    });
                else if (r <= 7)
                    return d.toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: true,
                    });
                else
                    return d.toLocaleDateString("en-IN", {
                        month: "short",
                        day: "numeric",
                    });
            });
            const pfx = currency === "inr" ? "₹" : currency === "usdt" ? "₮" : "$";
            const sma20 = activeIndicators.sma
                ? calcSMA(prices, indicatorPeriods.sma)
                : null;
            const ema20 = activeIndicators.ema
                ? calcEMA(prices, indicatorPeriods.ema)
                : null;
            const rsi = activeIndicators.rsi
                ? calcRSI(prices, indicatorPeriods.rsi)
                : null;
            const bb = activeIndicators.bb
                ? calcBollingerBands(prices, indicatorPeriods.bb)
                : null;
            const targetCandles = 48;
            const groupSize = Math.max(1, Math.floor(prices.length / targetCandles));
            const ohlc = activeIndicators.ohlc ? calcOHLC(prices, groupSize) : null;
            let indText = [];
            if (activeIndicators.sma && sma20)
                indText.push(`SMA(${indicatorPeriods.sma}): ${sma20.at(-1)?.toFixed(2) ?? "N/A"}`);
            if (activeIndicators.ema && ema20)
                indText.push(`EMA(${indicatorPeriods.ema}): ${ema20.at(-1)?.toFixed(2) ?? "N/A"}`);
            if (activeIndicators.rsi && rsi)
                indText.push(`RSI(${indicatorPeriods.rsi}): ${rsi.at(-1)?.toFixed(1) ?? "N/A"}`);
            if (activeIndicators.volume && volumes && volumes.length) {
                const lastVol = volumes[volumes.length - 1];
                indText.push(`Vol: ${(lastVol / 1e6).toFixed(1)}M`);
            }
            const indEl = $("indicatorValues");
            if (indEl)
                indEl.innerHTML = indText.join(" &nbsp;&nbsp;·&nbsp;&nbsp; ");
            if (chartInstance)
                chartInstance.destroy();
            const priceChartEl = $("priceChart");
            if (!priceChartEl)
                return;
            const datasets = [];
            if (activeIndicators.ohlc && ohlc && ohlc.length > 0) {
                const highSeries = [];
                const lowSeries = [];
                ohlc.forEach((c, i) => {
                    const idx = Math.min(i * groupSize, labels.length - 1);
                    highSeries[idx] = c.high;
                    lowSeries[idx] = c.low;
                });
                datasets.push({
                    label: "Price",
                    data: prices,
                    borderColor: "#00e5a0",
                    backgroundColor: "rgba(0,229,160,0.08)",
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.2,
                    pointRadius: 0,
                });
                datasets.push({
                    label: "High",
                    data: highSeries,
                    borderColor: "rgba(0, 191, 255, 0.55)",
                    borderWidth: 1,
                    borderDash: [2, 3],
                    pointRadius: 0,
                    fill: false,
                });
                datasets.push({
                    label: "Low",
                    data: lowSeries,
                    borderColor: "rgba(255, 71, 87, 0.55)",
                    borderWidth: 1,
                    borderDash: [2, 3],
                    pointRadius: 0,
                    fill: false,
                });
            }
            else {
                datasets.push({
                    label: "Price",
                    data: prices,
                    borderColor: "#00e5a0",
                    backgroundColor: "rgba(0,229,160,0.07)",
                    borderWidth: 2,
                    fill: true,
                    tension: 0.25,
                    pointRadius: 0,
                });
            }
            if (activeIndicators.sma && sma20)
                datasets.push({
                    label: "SMA",
                    type: "line",
                    data: sma20,
                    borderColor: "#00bfff",
                    borderWidth: 1.5,
                    borderDash: [5, 3],
                    pointRadius: 0,
                    fill: false,
                });
            if (activeIndicators.ema && ema20)
                datasets.push({
                    label: "EMA",
                    type: "line",
                    data: ema20,
                    borderColor: "#ff6b6b",
                    borderWidth: 1.5,
                    borderDash: [5, 3],
                    pointRadius: 0,
                    fill: false,
                });
            if (activeIndicators.bb && bb) {
                datasets.push({
                    label: "BB Upper",
                    type: "line",
                    data: bb.upper,
                    borderColor: "rgba(168,85,247,0.65)",
                    borderWidth: 1,
                    borderDash: [2, 4],
                    pointRadius: 0,
                    fill: false,
                });
                datasets.push({
                    label: "BB Mid",
                    type: "line",
                    data: bb.middle,
                    borderColor: "rgba(168,85,247,0.4)",
                    borderWidth: 1,
                    borderDash: [2, 2],
                    pointRadius: 0,
                    fill: false,
                });
                datasets.push({
                    label: "BB Lower",
                    type: "line",
                    data: bb.lower,
                    borderColor: "rgba(168,85,247,0.65)",
                    borderWidth: 1,
                    borderDash: [2, 4],
                    pointRadius: 0,
                    fill: false,
                });
            }
            if (activeIndicators.volume && volumes && volumes.length > 0) {
                const volData = volumes.map((v, i) => ({
                    x: labels[Math.min(i, labels.length - 1)],
                    y: v,
                }));
                datasets.push({
                    label: "Volume",
                    type: "bar",
                    data: volData,
                    backgroundColor: "rgba(100, 149, 237, 0.25)",
                    borderColor: "rgba(100, 149, 237, 0.5)",
                    borderWidth: 1,
                    yAxisID: "volume",
                    barThickness: 3,
                });
            }
            const crosshairPlugin = {
                id: "crosshair",
                afterDatasetsDraw(chart) {
                    const { ctx, tooltip, chartArea } = chart;
                    if (!tooltip || !tooltip._active || !tooltip._active.length)
                        return;
                    const activePoint = tooltip._active[0];
                    const x = activePoint.element.x;
                    const y = activePoint.element.y;
                    ctx.save();
                    ctx.strokeStyle = "rgba(0, 229, 160, 0.4)";
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 3]);
                    ctx.beginPath();
                    ctx.moveTo(x, chartArea.top);
                    ctx.lineTo(x, chartArea.bottom);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(chartArea.left, y);
                    ctx.lineTo(chartArea.right, y);
                    ctx.stroke();
                    ctx.restore();
                },
            };
            chartInstance = new Chart(priceChartEl, {
                type: "line",
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: {
                                color: "#e8f0fe",
                                font: { size: 10, family: "DM Sans" },
                            },
                            onClick: Chart.defaults.plugins.legend.onClick,
                        },
                        tooltip: {
                            mode: "index",
                            intersect: false,
                            backgroundColor: "rgba(14,12,20,0.94)",
                            titleColor: "#00e5a0",
                            bodyColor: "#e8f0fe",
                            borderColor: "rgba(0,229,160,0.3)",
                            borderWidth: 1,
                            callbacks: {
                                label(ctx) {
                                    const val = ctx.raw;
                                    const num = typeof val === "number"
                                        ? val
                                        : val && val.y != null
                                            ? val.y
                                            : val;
                                    return `${ctx.dataset.label}: ${pfx}${Number(num).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
                                },
                            },
                        },
                    },
                    scales: {
                        x: {
                            grid: { color: "rgba(255,255,255,0.05)" },
                            offset: true,
                            ticks: {
                                color: "#7a8fa6",
                                maxRotation: 0,
                                autoSkip: true,
                                maxTicksLimit: r <= 1 ? 10 : r <= 7 ? 8 : r <= 30 ? 7 : 6,
                                padding: 8,
                                font: { size: 10, family: "DM Sans" },
                            },
                            border: { display: false },
                        },
                        y: {
                            grid: { color: "rgba(255,255,255,0.05)" },
                            ticks: {
                                color: "#7a8fa6",
                                callback: (v) => `${pfx}${v.toLocaleString()}`,
                            },
                            border: { display: false },
                            position: "left",
                        },
                        volume: {
                            type: "linear",
                            position: "right",
                            grid: { color: "rgba(255,255,255,0.03)", drawOnChartArea: false },
                            ticks: {
                                color: "#7a8fa6",
                                callback: (v) => (v / 1e6).toFixed(1) + "M",
                            },
                            border: { display: false },
                            display: activeIndicators.volume,
                        },
                    },
                    interaction: { mode: "nearest", axis: "x" },
                },
                plugins: [crosshairPlugin],
            });
        }
        catch (err) {
            console.error("[chart]", err);
            const indEl = $("indicatorValues");
            if (indEl)
                indEl.textContent = "Chart unavailable — try a different range.";
        }
    }
    function toggleIndicator(ind, btn) {
        activeIndicators[ind] = !activeIndicators[ind];
        // Fallback: if all indicators are turned off, default to showing ohlc (Candles)
        const activeCount = Object.values(activeIndicators).filter(Boolean).length;
        if (activeCount === 0) {
            activeIndicators.ohlc = true;
        }
        document.querySelectorAll(".ind-btn").forEach((b) => {
            const key = b.getAttribute("data-indicator");
            b.classList.toggle("active", !!activeIndicators[key]);
        });
        loadChart();
    }
    async function openChartModal(coinId, coinName) {
        lastQueriedChartCoin = coinId;
        const ct = $("chartTitle");
        if (ct)
            ct.textContent = `${coinName} — Live Chart`;
        activeIndicators = {
            ohlc: false,
            sma: false,
            ema: false,
            rsi: false,
            bb: false,
            volume: false,
        };
        document.querySelectorAll(".ind-btn").forEach((btn) => {
            const key = btn.getAttribute("data-indicator");
            btn.classList.toggle("active", !!activeIndicators[key]);
        });
        $("chartModal")?.classList.add("open");
        await loadChart();
    }
    function closeChartModal() {
        $("chartModal")?.classList.remove("open");
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
        lastQueriedChartCoin = null;
    }
    let currentAlertSymbol = "";
    function openAlertModal(sym, price) {
        if (!window.stockwise?.currentUser()) {
            window.stockwise?.openAuth("login");
            return;
        }
        currentAlertSymbol = sym;
        const sl = $("alertSymbolLabel");
        if (sl)
            sl.textContent = sym;
        const ap = $("alertPrice");
        if (ap)
            ap.value = price != null ? Number(price).toFixed(3) : "";
        const ae = $("alertErr");
        if (ae)
            ae.textContent = "";
        $("alertModal")?.classList.add("open");
    }
    function closeAlertModal() {
        $("alertModal")?.classList.remove("open");
    }
    async function saveAlert() {
        const price = parseFloat($("alertPrice")?.value);
        const dir = $("alertDir")?.value;
        const errEl = $("alertErr");
        if (!errEl)
            return;
        if (!price || price <= 0) {
            errEl.textContent = "Enter a valid price";
            return;
        }
        const res = await fetch("/api/alerts", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                symbol: currentAlertSymbol,
                target_price: price,
                direction: dir,
            }),
        });
        const data = await res.json();
        if (data.success) {
            closeAlertModal();
            window.stockwise?.toast(`Alert set for ${currentAlertSymbol} 🔔`, "success");
        }
        else {
            errEl.textContent = data.error || "Failed to save alert";
        }
    }
    function fmtPrice(p, currency) {
        if (p == null || p === "")
            return "\u2014";
        const locale = currency === "inr" ? "en-IN" : "en-US";
        if (p >= 10000)
            return p.toLocaleString(locale, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            });
        if (p >= 1000)
            return p.toLocaleString(locale, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });
        if (p >= 1)
            return p.toFixed(4);
        return p.toFixed(6);
    }
    function fmtM(n, currency) {
        const pfx = currency === "inr" ? "₹" : currency === "usdt" ? "₮" : "$";
        if (!n || n === 0)
            return pfx + "0";
        if (n >= 1e12)
            return pfx + (n / 1e12).toFixed(2) + "T";
        if (n >= 1e9)
            return pfx + (n / 1e9).toFixed(2) + "B";
        if (n >= 1e6)
            return pfx + (n / 1e6).toFixed(2) + "M";
        return pfx + n.toLocaleString();
    }
    function escHtml(s) {
        return String(s ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        })[c]);
    }
    function escAttr(s) {
        return String(s ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        })[c]);
    }
    async function loadProfileSidebar() {
        try {
            const res = await fetch("/api/me", { credentials: "include" });
            const me = await res.json();
            if (!res.ok || !me.loggedIn)
                return;
            const pn = $("profileName");
            if (pn)
                pn.textContent = me.username || "User";
            const pe = $("profileEmail");
            if (pe)
                pe.textContent = me.email || "";
            const avEl = $("profileAvatar");
            if (avEl && window.auSvg) {
                const av = me.avatar || {};
                avEl.innerHTML = window.auSvg(me.username || "U", {
                    bg_color: av.bg_color || "#00e5a0",
                    texture: av.texture || "solid",
                    accessory: av.accessory || "none",
                    energy: av.energy || "none",
                });
                avEl.style.backgroundColor = "var(--bg3)";
            }
            const [pRes, aRes] = await Promise.all([
                fetch("/api/portfolio", { credentials: "include" }),
                fetch("/api/alerts", { credentials: "include" }),
            ]);
            const portfolios = pRes.ok ? await pRes.json() : [];
            const alerts = aRes.ok ? await aRes.json() : [];
            const sp = $("sStatPortfolio");
            if (sp)
                sp.textContent = portfolios.length;
            const sa = $("sStatAlerts");
            if (sa)
                sa.textContent = alerts.length;
            const sw = $("sStatWatch");
            if (sw)
                sw.textContent = favSet.length;
            if (me.created_at) {
                const days = Math.max(1, Math.floor((Date.now() - new Date(me.created_at)) / 864e5));
                const el = $("sStatDays");
                if (el)
                    el.textContent = days + (days === 1 ? " day" : " days");
            }
        }
        catch (_) { }
    }
    function onDocumentKeydown(e) {
        if (e.key === "Escape") {
            closeAlertModal();
            closeChartModal();
        }
    }
    function setAutoRefresh() {
        setInterval(() => {
            if (currentType === "stock")
                loadStocks(currentStockCategory, true);
            else
                loadPrices(currentCryptoCategory, true);
        }, 25000);
    }
    async function loadAll() {
        showShimmer();
        await Promise.allSettled([
            loadPrices(currentCryptoCategory, true),
            loadStocks(currentStockCategory, true),
        ]);
        filterTable();
    }
    // Debounce helper
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }
    // Layout switcher implementation
    function changeLayoutMode(mode) {
        currentViewMode = mode;
        localStorage.setItem("sw_layout", mode);
        // Toggle active classes on toolbar buttons
        const gridBtn = $("layoutGridBtn");
        const listBtn = $("layoutListBtn");
        if (gridBtn)
            gridBtn.classList.toggle("active", mode === "grid");
        if (listBtn)
            listBtn.classList.toggle("active", mode === "list");
        // Rerender table
        filterTable();
    }
    // Socket.io Real-time setup
    function initRealtimeUpdates() {
        if (typeof io === "undefined") {
            console.warn("[tracker] Socket.io client not loaded. Live ticks disabled.");
            return;
        }
        const socket = io();
        function updateWsStatus(connected) {
            const el = document.getElementById('wsStatus');
            if (!el)
                return;
            el.textContent = connected ? '● LIVE' : '○ RECONNECTING';
            el.style.color = connected ? 'var(--accent)' : 'var(--sell)';
        }
        socket.on("connect", () => updateWsStatus(true));
        socket.on("disconnect", () => updateWsStatus(false));
        socket.on("reconnect", () => updateWsStatus(true));
        socket.on("tickerUpdate", (data) => {
            if (!data || !data.symbol)
                return;
            const sym = data.symbol.toUpperCase();
            const coin = allCoins.find((c) => (c.symbol || "").toUpperCase() === sym);
            if (!coin)
                return;
            if (data.changePercent != null) {
                coin.price_change_percentage_24h = data.changePercent;
            }
            const currency = $("currencySelect")?.value || "usd";
            const oldPrice = coin.current_price || 0;
            const newPrice = data.price;
            // For CoinDCX-merged coins, reset premiumMultiplier to recalibrate
            // against the fresh CoinDCX INR baseline on this very ticker.
            if (_refreshedCoins.has(sym)) {
                coin.premium_multiplier = undefined;
            }
            let displayPrice;
            if (currency === "inr") {
                if (!coin.premium_multiplier) {
                    coin.premium_multiplier =
                        oldPrice > 0 && oldPrice !== newPrice
                            ? oldPrice / newPrice
                            : usdInrRate;
                }
                displayPrice = newPrice * coin.premium_multiplier;
            }
            else {
                displayPrice = newPrice;
            }
            coin.current_price = displayPrice;
            // Find rendered card in DOM
            const card = document.querySelector(`.cr[data-sym="${sym}"]`);
            if (card) {
                const priceEl = card.querySelector(".cr-price");
                const chg24El = card.querySelector(".cr-chg-row .chg-box:nth-child(2) .val");
                if (priceEl) {
                    const pfx = currency === "inr" ? "₹" : currency === "usdt" ? "₮" : "$";
                    priceEl.textContent = pfx + fmtPrice(displayPrice, currency);
                    // Trigger glowing feedback
                    const borderClass = newPrice >= oldPrice ? "pulse-glow-up" : "pulse-glow-down";
                    const textClass = newPrice >= oldPrice ? "pulse-price-up" : "pulse-price-down";
                    card.classList.remove("pulse-glow-up", "pulse-glow-down");
                    priceEl.classList.remove("pulse-price-up", "pulse-price-down");
                    // Force reflow
                    void card.offsetWidth;
                    void priceEl.offsetWidth;
                    card.classList.add(borderClass);
                    priceEl.classList.add(textClass);
                }
                if (chg24El && data.changePercent != null) {
                    const chgVal = data.changePercent;
                    const sign = chgVal > 0 ? "+" : "";
                    chg24El.textContent = `${sign}${chgVal.toFixed(2)}%`;
                    chg24El.className = "val " + (chgVal === 0 ? "neutral" : chgVal > 0 ? "positive" : "negative");
                }
            }
        });
        socket.on("stockUpdates", (updates) => {
            if (!Array.isArray(updates))
                return;
            for (const update of updates) {
                const stock = allStocks.find((s) => s.symbol === update.symbol);
                if (!stock)
                    continue;
                const oldPrice = stock.current_price || 0;
                stock.current_price = update.current_price;
                if (update.price_change_percentage_24h != null) {
                    stock.price_change_percentage_24h = update.price_change_percentage_24h;
                }
                const card = document.querySelector(`.cr[data-sym="${update.symbol}"]`);
                if (!card)
                    continue;
                const priceEl = card.querySelector(".cr-price");
                const chg24El = card.querySelector(".cr-chg-row .chg-box:nth-child(2) .val");
                const currency = $("currencySelect")?.value || "usd";
                const isStock = ["nifty50", "next50", "midcap", "smallcap"].includes(stock.category);
                let displayPrice = update.current_price;
                if (isStock && (currency === "usd" || currency === "usdt")) {
                    displayPrice = displayPrice / usdInrRate;
                }
                if (priceEl) {
                    const pfx = currency === "inr" ? "₹" : currency === "usdt" ? "₮" : "$";
                    priceEl.textContent = pfx + fmtPrice(displayPrice, currency);
                    const borderClass = update.current_price >= oldPrice ? "pulse-glow-up" : "pulse-glow-down";
                    const textClass = update.current_price >= oldPrice ? "pulse-price-up" : "pulse-price-down";
                    card.classList.remove("pulse-glow-up", "pulse-glow-down");
                    priceEl.classList.remove("pulse-price-up", "pulse-price-down");
                    void card.offsetWidth;
                    void priceEl.offsetWidth;
                    card.classList.add(borderClass);
                    priceEl.classList.add(textClass);
                }
                if (chg24El && update.price_change_percentage_24h != null) {
                    const chgVal = update.price_change_percentage_24h;
                    const sign = chgVal > 0 ? "+" : "";
                    chg24El.textContent = `${sign}${chgVal.toFixed(2)}%`;
                    chg24El.className = "val " + (chgVal === 0 ? "neutral" : chgVal > 0 ? "positive" : "negative");
                }
            }
        });
    }
    async function boot() {
        loadProfileSidebar();
        updateWatchlistCount();
        // Set Layout Toggle Button states
        const gridBtn = $("layoutGridBtn");
        const listBtn = $("layoutListBtn");
        if (gridBtn)
            gridBtn.classList.toggle("active", currentViewMode === "grid");
        if (listBtn)
            listBtn.classList.toggle("active", currentViewMode === "list");
        // Bind search input to debounced search
        const searchInput = $("searchInput");
        if (searchInput) {
            searchInput.removeAttribute("oninput");
            searchInput.addEventListener("input", debounce(filterTable, 150));
        }
        const grid = $("coinsGrid");
        if (grid) {
            grid.addEventListener("mousemove", (e) => {
                if (!e.target || typeof e.target.closest !== "function")
                    return;
                const card = e.target.closest(".cr");
                if (card) {
                    const rect = card.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    card.style.setProperty("--mouse-x", `${x}px`);
                    card.style.setProperty("--mouse-y", `${y}px`);
                }
            });
        }
        // Force load exchange rate before fetching any prices or setting up WebSockets
        await getUsdInrRate(true);
        const p = new URLSearchParams(location.search);
        const initType = p.get("type") === "stock" || p.get("type") === "crypto"
            ? p.get("type")
            : "all";
        document.querySelectorAll(".view-btn").forEach((b) => {
            const t = b.getAttribute("onclick") || "";
            b.classList.toggle("active", t.includes(`'${initType}'`));
        });
        if (initType === "stock") {
            currentType = "stock";
            await loadStocks();
        }
        else if (initType === "crypto") {
            currentType = "crypto";
            await loadPrices();
        }
        else {
            currentType = "all";
            await loadAll();
        }
        updateCategoryBar(currentType);
        setAutoRefresh();
        initRealtimeUpdates();
    }
    document.addEventListener("DOMContentLoaded", boot);
    document.addEventListener("keydown", onDocumentKeydown, true);
    window.$$sort = setSort;
    window.$$switchType = switchType;
    window.$$setCryptoCat = (cat, btn) => {
        changeCryptoCategory(cat, btn);
    };
    window.$$setStockCat = (cat, btn) => {
        changeStockCategory(cat, btn);
    };
    window.$$changeCurrency = changeCurrency;
    window.$$toggleFav = toggleFavMode;
    window.$$filter = filterTable;
    window.$$renderTable = renderTable;
    window.loadPrices = loadPrices;
    window.loadStocks = loadStocks;
    window.openChartModal = openChartModal;
    window.closeChartModal = closeChartModal;
    window.loadChart = loadChart;
    window.openAlertModal = openAlertModal;
    window.closeAlertModal = closeAlertModal;
    window.saveAlert = saveAlert;
    window.toggleFav = toggleFav;
    window.toggleFavMode = toggleFavMode;
    window.setSort = setSort;
    window.switchType = switchType;
    window.changeCryptoCategory = changeCryptoCategory;
    window.changeStockCategory = changeStockCategory;
    window.filterTable = filterTable;
    window.changeCurrency = changeCurrency;
    window.toggleIndicator = toggleIndicator;
    window.forceFreshRefresh = forceFreshRefresh;
    window.changeLayoutMode = changeLayoutMode;
    function changeCurrency() {
        if (currentType === "stock")
            loadStocks(null, true);
        else
            loadPrices(currentCryptoCategory, true);
    }
    window.changeCurrency = changeCurrency;
    function forceFreshRefresh() {
        if (currentType === "stock")
            loadStocks(currentStockCategory, true);
        else if (currentType === "crypto")
            loadPrices(currentCryptoCategory, true);
        else
            loadAllWithFresh();
    }
    async function loadAllWithFresh() {
        showShimmer();
        await Promise.allSettled([
            loadPrices(currentCryptoCategory, true),
            loadStocks(currentStockCategory, true),
        ]);
        filterTable();
    }
})();
