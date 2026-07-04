(function () {
  "use strict";

  function sanitizeHtml(str) {
    const el = document.createElement("div");
    el.textContent = str;
    const allowed = ["b", "i", "strong", "em", "ul", "ol", "li", "br", "p", "code", "pre", "span", "a"];
    const tmp = document.createElement("div");
    tmp.innerHTML = el.textContent;
    tmp.querySelectorAll("*").forEach(n => {
      if (!allowed.includes(n.tagName.toLowerCase())) {
        n.replaceWith(n.textContent);
        return;
      }
      if (n.tagName.toLowerCase() === "a") {
        const href = n.getAttribute("href") || "";
        if (href.startsWith("javascript:") || href.startsWith("data:")) {
          n.removeAttribute("href");
        }
        n.setAttribute("target", "_blank");
        n.setAttribute("rel", "noopener noreferrer");
      }
      [...n.attributes].forEach(attr => {
        if (!["href", "target", "rel"].includes(attr.name)) n.removeAttribute(attr.name);
      });
    });
    return tmp.innerHTML;
  }

  try {
    fetch("/api/demo/coach/llm-status").then(r => r.json()).then(d => {
      const badge = document.getElementById("coachBadge");
      if (badge && d.provider && d.provider !== "none") badge.textContent = d.provider;
    }).catch(() => {});
  } catch (_) {}

  let coachContext = {
    completedLessons: [],
    activeBotsCount: 0,
    portfolioValue: 0,
    balance: 10000,
    level: "Novice",
    xp: 0,
  };

  let isProcessing = false;

  // ─── API ───────────────────────────────────────────────

  async function apiPost(path, body, signal) {
    try {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": window.csrfToken || "" },
        credentials: "include",
        body: JSON.stringify(body),
        signal: signal,
      });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  async function apiGet(path) {
    try {
      const r = await fetch(path, { credentials: "include" });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  // ─── COACH UI ──────────────────────────────────────────

  function getCoachLog() {
    return document.getElementById("coachChatLog");
  }

  function getCoachInput() {
    return document.getElementById("coachInput");
  }

  function appendMsg(role, content, suggestions) {
    const log = getCoachLog();
    if (!log) return;

    const bubble = document.createElement("div");
    bubble.className = "coach-chat-bubble " + role;

    const avatar = document.createElement("div");
    avatar.className = "coach-avatar";
    avatar.textContent = role === "bot" ? "AI" : "ME";

    const body = document.createElement("div");
    body.className = "coach-bubble-body";

    if (role === "bot") {
      const html = document.createElement("div");
      html.className = "coach-msg-html";
      html.innerHTML = sanitizeHtml(content);
      body.appendChild(html);

      if (suggestions && suggestions.length > 0) {
        const sg = document.createElement("div");
        sg.className = "coach-suggestions";
        suggestions.forEach((s) => {
          const btn = document.createElement("button");
          btn.className = "coach-suggestion-btn";
          btn.textContent = s;
          btn.onclick = function () {
            var quizMatch = s.match(/^Take\s+(?:the\s+)?(.+?)\s+quiz$/i);
            if (quizMatch) {
              var topic = quizMatch[1].toLowerCase();
              var lessonMap = {
                rsi: "int_rsi",
                macd: "int_macd",
                grid: "adv_grid",
                candlestick: "int_candles",
                candlesticks: "int_candles",
              };
              var lessonId = lessonMap[topic] || null;
              if (lessonId && typeof openAcademyLesson === "function") {
                openAcademyLesson(lessonId);
                return;
              }
            }
            var createMatch = s.match(/^Create\s+(?:an?\s+)?(.+?)\s+bot$/i);
            if (createMatch && typeof switchRightTab === "function") {
              switchRightTab("bots");
              setTimeout(function () {
                var deployBtn = document.querySelector(".ca-deploy-btn");
                if (deployBtn && typeof deployBtn.click === "function") deployBtn.click();
              }, 300);
              return;
            }
            if (getCoachInput()) {
              getCoachInput().value = s;
              sendCoachChat();
            }
          };
          sg.appendChild(btn);
        });
        body.appendChild(sg);
      }
    } else {
      body.textContent = content;
    }

    bubble.appendChild(avatar);
    bubble.appendChild(body);
    log.appendChild(bubble);

    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
  }

  function showTyping() {
    const log = getCoachLog();
    if (!log) return;
    const dot = document.createElement("div");
    dot.className = "coach-chat-bubble bot typing";
    dot.id = "coachTyping";
    dot.innerHTML =
      '<div class="coach-avatar">AI</div><div class="coach-bubble-body"><span class="typing-dots"><span>.</span><span>.</span><span>.</span></span> <span style="font-size:0.7rem;opacity:0.5;">thinking...</span></div>';
    log.appendChild(dot);
    log.scrollTop = log.scrollHeight;
  }

  function removeTyping() {
    const dot = document.getElementById("coachTyping");
    if (dot) dot.remove();
  }

  // ─── COACH LOGIC ───────────────────────────────────────

  async function updateContext() {
    const data = await apiGet("/api/demo/account");
    if (data) {
      coachContext.balance = data.balance ?? 10000;
      coachContext.xp = data.xp ?? 0;
      coachContext.level = data.level ?? "Novice";
      coachContext.completedLessons = data.completedLessons ?? [];
      coachContext.portfolioValue = data.portfolio
        ? data.portfolio.reduce(function (sum, p) {
            return sum + p.quantity * (p.avg_buy_price || 0);
          }, 0)
        : 0;
    }
    const bots = await apiGet("/api/demo/bots");
    if (Array.isArray(bots)) {
      coachContext.activeBotsCount = bots.filter(function (b) {
        return b.status === "active";
      }).length;
    }
  }

  function showWelcome() {
    const log = getCoachLog();
    if (!log) return;
    if (log.querySelector(".coach-chat-bubble")) return;

    const greetings = [
      "Hey! I'm your AI Trading Coach — here to help you learn and trade smarter.",
      "Ask me anything about crypto, trading strategies, your portfolio, or the platform.",
      "I know live market prices and can analyze trends in real-time.",
    ];

    const suggestionBtns = [
      "What is Bitcoin?",
      "What is leverage in trading?",
      "Analyze BTC market trend",
      "Check my progress",
    ];

    let idx = 0;
    function showNext() {
      if (idx < greetings.length) {
        appendMsg("bot", greetings[idx]);
        idx++;
        setTimeout(showNext, 600 + Math.random() * 400);
      } else {
        appendMsg("bot", "Try asking me anything!", suggestionBtns);
      }
    }
    showNext();
  }

  async function sendCoachChat() {
    if (isProcessing) return;
    const input = getCoachInput();
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    isProcessing = true;

    appendMsg("user", text);
    showTyping();

    // LLM responses may take longer — use extended timeout (30s)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let response;
    try {
      response = await apiPost("/api/demo/coach/ask", { message: text }, controller.signal);
    } catch {
      response = null;
    } finally {
      clearTimeout(timeout);
    }

    removeTyping();

    if (response) {
      setTimeout(function () {
        appendMsg("bot", response.message || "I'm not sure how to respond to that. Try asking about lessons, bots, or your account!", response.suggestions);

        if (response.action) {
          handleCoachAction(response.action);
        }

        updateContext();
        isProcessing = false;
      }, 300 + Math.random() * 200);
    } else {
      setTimeout(function () {
        appendMsg("bot", "I'm having trouble reaching the server. Here's what I know offline:", [
          "What is RSI?",
          "Explain Grid trading",
          "What should I learn first?",
        ]);
        isProcessing = false;
      }, 500);
    }
  }

  function handleCoachAction(action) {
    if (!action) return;
    const addSuggestion = function (label, fn) {
      const lastBotMsg = document.querySelector(".coach-chat-bubble.bot:last-child .coach-suggestions");
      if (lastBotMsg) {
        const btn = document.createElement("button");
        btn.className = "coach-suggestion-btn";
        btn.textContent = label;
        btn.onclick = fn;
        lastBotMsg.appendChild(btn);
      }
    };
    switch (action.type) {
      case "switch_tab":
        addSuggestion("🔀 Go to " + action.payload, function () {
          if (typeof switchRightTab === "function") switchRightTab(action.payload);
        });
        break;
      case "open_lesson":
        addSuggestion("📖 Open full lesson", function () {
          if (typeof openAcademyLesson === "function" && action.payload) openAcademyLesson(action.payload);
        });
        break;
      case "open_bot_creator":
        addSuggestion("🤖 Open bot creator", function () {
          if (typeof switchRightTab === "function") {
            switchRightTab("bots");
            setTimeout(function () {
              const deployBtn = document.querySelector(".ca-deploy-btn");
              if (deployBtn && typeof deployBtn.click === "function") deployBtn.click();
            }, 300);
          }
        });
        break;
      case "start_tour":
        addSuggestion("🎯 Start guided tour", function () {
          if (typeof startVisualIntroTour === "function") startVisualIntroTour();
        });
        break;
    }
  }

  // ─── INIT ──────────────────────────────────────────────

  async function init() {
    const input = getCoachInput();
    if (!input) return;

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendCoachChat();
      }
    });

    const sendBtn = document.getElementById("coachSendBtn");
    if (sendBtn) {
      sendBtn.addEventListener("click", sendCoachChat);
    }

    await updateContext();
    showWelcome();
  }

  // Expose for inline onclick handlers
  window.sendCoachChat = sendCoachChat;
  window.appendCoachMsg = appendMsg;
  window.getCoachContext = function () {
    return coachContext;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
