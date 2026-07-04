import { askLLM, isLLMAvailable, type MarketData } from "./llmService.js";

export interface CoachContext {
  userId?: number;
  currentTab?: string;
  completedLessons: string[];
  activeBotsCount: number;
  portfolioValue: number;
  balance: number;
  level: string;
  xp: number;
}

export interface CoachResponse {
  message: string;
  richHtml?: string;
  suggestions?: string[];
  action?: {
    type: "switch_tab" | "open_lesson" | "open_bot_creator" | "start_tour";
    payload?: string;
  };
}

interface LessonContent {
  id: string;
  title: string;
  category: "beginner" | "intermediate" | "advanced";
  xpReward: number;
  prerequisites: string[];
  article: string;
  quiz: { question: string; options: string[]; correctIdx: number };
}

const LESSONS: LessonContent[] = [
  {
    id: "beg_intro",
    title: "Cryptocurrency & Order Book 101",
    category: "beginner",
    xpReward: 50,
    prerequisites: [],
    article: `
      <h3>What is Cryptocurrency?</h3>
      <p>Cryptocurrency is digital money secured by cryptography. Unlike traditional currency, it operates on decentralized networks called blockchains.</p>
      <h4>Key Concepts:</h4>
      <ul>
        <li><strong>Blockchain</strong> — A distributed ledger recording all transactions across a network of computers.</li>
        <li><strong>Order Book</strong> — A list of buy (bids) and sell (asks) orders for a specific asset, organized by price level.</li>
        <li><strong>Bid-Ask Spread</strong> — The difference between the highest price a buyer will pay and the lowest price a seller will accept.</li>
        <li><strong>Liquidity</strong> — How easily an asset can be bought or sold without affecting its price.</li>
      </ul>
      <h4>Reading an Order Book:</h4>
      <p>Green columns show bids (buyers). Red columns show asks (sellers). The top bid and lowest ask form the current spread. A tight spread means high liquidity.</p>
    `,
    quiz: {
      question: "What does the bid-ask spread represent?",
      options: [
        "The total volume traded in a day",
        "The difference between the highest buy order and lowest sell order",
        "The price movement over 24 hours",
        "The number of active traders",
      ],
      correctIdx: 1,
    },
  },
  {
    id: "int_candles",
    title: "Reading Candlestick Patterns",
    category: "beginner",
    xpReward: 75,
    prerequisites: ["beg_intro"],
    article: `
      <h3>Candlestick Basics</h3>
      <p>Each candlestick shows four price points: Open, High, Low, and Close (OHLC) over a specific time period.</p>
      <h4>Candle Anatomy:</h4>
      <ul>
        <li><strong>Body</strong> — The range between open and close. Green (or white) means close > open (bullish). Red (or black) means close < open (bearish).</li>
        <li><strong>Wick / Shadow</strong> — The thin lines above and below the body showing the high and low prices.</li>
        <li><strong>Real Body</strong> — The thick part of the candle. A long body indicates strong buying or selling pressure.</li>
      </ul>
      <h4>Important Patterns:</h4>
      <ul>
        <li><strong>Doji</strong> — Open and close are nearly equal. Signals market indecision.</li>
        <li><strong>Hammer</strong> — Small body at top with a long lower wick. Bullish reversal signal.</li>
        <li><strong>Engulfing</strong> — A large candle completely engulfs the previous small candle. Strong reversal signal.</li>
      </ul>
    `,
    quiz: {
      question: "What does a green (bullish) candlestick indicate?",
      options: [
        "The closing price was lower than the opening price",
        "The closing price was higher than the opening price",
        "Trading volume was below average",
        "The market is in a downtrend",
      ],
      correctIdx: 1,
    },
  },
  {
    id: "int_rsi",
    title: "Indicator Study: RSI",
    category: "intermediate",
    xpReward: 75,
    prerequisites: ["int_candles"],
    article: `
      <h3>Relative Strength Index (RSI)</h3>
      <p>RSI is a momentum oscillator that measures the speed and magnitude of recent price changes. It ranges from 0 to 100.</p>
      <h4>How it Works:</h4>
      <ul>
        <li>RSI compares the magnitude of recent gains to recent losses.</li>
        <li>A 14-period lookback is the standard setting.</li>
        <li>Values above <strong>70</strong> suggest an asset is <strong>overbought</strong> (may be due for a pullback).</li>
        <li>Values below <strong>30</strong> suggest an asset is <strong>oversold</strong> (may be due for a bounce).</li>
      </ul>
      <h4>Trading with RSI:</h4>
      <ul>
        <li><strong>RSI_BOT strategy</strong>: Our automated bot buys when RSI drops below the buy threshold (default 35) and sells when it rises above the sell threshold (default 65).</li>
        <li><strong>Divergence</strong>: When price makes a new high but RSI doesn't, it signals weakening momentum — a potential reversal.</li>
      </ul>
    `,
    quiz: {
      question: "What does an RSI reading above 70 typically suggest?",
      options: [
        "The asset is oversold and likely to bounce",
        "The asset is overbought and may pull back",
        "Trading volume is at a monthly low",
        "The market is perfectly balanced",
      ],
      correctIdx: 1,
    },
  },
  {
    id: "int_macd",
    title: "MACD & Trend Following",
    category: "intermediate",
    xpReward: 75,
    prerequisites: ["int_candles"],
    article: `
      <h3>Moving Average Convergence Divergence (MACD)</h3>
      <p>MACD is a trend-following indicator showing the relationship between two moving averages of price.</p>
      <h4>Components:</h4>
      <ul>
        <li><strong>MACD Line</strong> — 12-period EMA minus 26-period EMA.</li>
        <li><strong>Signal Line</strong> — 9-period EMA of the MACD line.</li>
        <li><strong>Histogram</strong> — The difference between the MACD line and Signal line.</li>
      </ul>
      <h4>MACD Crossovers:</h4>
      <ul>
        <li><strong>Bullish Crossover</strong>: MACD line crosses above the Signal line → BUY signal.</li>
        <li><strong>Bearish Crossover</strong>: MACD line crosses below the Signal line → SELL signal.</li>
        <li>The <strong>MACD_BOT</strong> strategy automates this: it monitors for crossovers and executes trades automatically.</li>
      </ul>
    `,
    quiz: {
      question: "What does a bullish MACD crossover indicate?",
      options: [
        "The MACD line crosses below the signal line",
        "The MACD line crosses above the signal line",
        "Price breaks below support",
        "Volume spikes suddenly",
      ],
      correctIdx: 1,
    },
  },
  {
    id: "adv_grid",
    title: "Understanding Grid Trading Bots",
    category: "advanced",
    xpReward: 100,
    prerequisites: ["int_rsi", "int_macd"],
    article: `
      <h3>Grid Trading Strategy</h3>
      <p>Grid trading is a systematic strategy that places buy and sell orders at predetermined price levels around a set baseline price.</p>
      <h4>How Grid Bots Work:</h4>
      <ul>
        <li>The bot sets a <strong>baseline price</strong> when activated.</li>
        <li>If the price drops by a set percentage (the <strong>grid_percent</strong>), the bot buys.</li>
        <li>If the price rises by the same percentage, the bot sells the position.</li>
        <li>This captures profit from sideways or oscillating markets.</li>
      </ul>
      <h4>Grid_BOT Parameters:</h4>
      <ul>
        <li><strong>grid_percent</strong> (default 1.5%): The price movement needed to trigger a trade. Smaller values = more frequent trades.</li>
        <li>The bot uses 15% of available balance per buy (max $800 USD).</li>
      </ul>
      <h4>When Grid Trading Works Best:</h4>
      <p>Grid bots excel in ranging/consolidating markets. In strong trending markets, the bot may buy once and never get a chance to sell (or vice versa).</p>
    `,
    quiz: {
      question: "In what type of market does grid trading perform best?",
      options: [
        "Strong bullish trending markets",
        "Strong bearish trending markets",
        "Ranging / consolidating markets",
        "High volatility breakout markets",
      ],
      correctIdx: 2,
    },
  },
  {
    id: "adv_risk",
    title: "Risk Management & Position Sizing",
    category: "advanced",
    xpReward: 100,
    prerequisites: ["adv_grid"],
    article: `
      <h3>Risk Management Fundamentals</h3>
      <p>Professional traders focus more on risk management than on finding the perfect entry. Here's how to protect your capital.</p>
      <h4>The 1% Rule:</h4>
      <p>Never risk more than 1-2% of your total account on a single trade. With a $10,000 demo account, that means max loss per trade is $100-$200.</p>
      <h4>Position Sizing:</h4>
      <ul>
        <li><strong>Fixed Percentage</strong>: Risk the same % of your account on every trade (e.g., 1%).</li>
        <li><strong>Kelly Criterion</strong>: A mathematical formula for optimal position sizing based on win rate and risk/reward ratio.</li>
      </ul>
      <h4>Stop Losses:</h4>
      <ul>
        <li>Always set a stop loss before entering a trade.</li>
        <li>Trailing stops lock in profits as the price moves in your favor.</li>
        <li>The GRID_BOT's baseline price acts as an automatic reference for exits.</li>
      </ul>
      <h4>Diversification:</h4>
      <p>Don't put all your capital into one asset. Spread across correlated and uncorrelated assets to reduce overall portfolio volatility.</p>
    `,
    quiz: {
      question: "What is the recommended maximum risk per trade for a $10,000 account?",
      options: [
        "$500-$1000",
        "$100-$200",
        "$2000-$3000",
        "$50-$100",
      ],
      correctIdx: 1,
    },
  },
  {
    id: "adv_bot_ops",
    title: "Bot Operations & Monitoring",
    category: "advanced",
    xpReward: 75,
    prerequisites: ["adv_grid"],
    article: `
      <h3>Managing Your Trading Bots</h3>
      <p>Automated bots require monitoring and periodic adjustment. Here's how to operate them like a pro.</p>
      <h4>Bot Lifecycle:</h4>
      <ol>
        <li><strong>Create</strong> — Choose a strategy, name your bot, and set parameters.</li>
        <li><strong>Monitor</strong> — Watch the live log console for trade execution details.</li>
        <li><strong>Evaluate</strong> — Check performance: win rate, profit factor, drawdown.</li>
        <li><strong>Adjust</strong> — Fine-tune parameters based on market conditions.</li>
      </ol>
      <h4>Log Interpretation:</h4>
      <ul>
        <li><strong>🟢 EXECUTE</strong> — A buy order was filled. Check the price and quantity.</li>
        <li><strong>🔴 EXECUTE</strong> — A sell order was filled. Check the profit/loss.</li>
        <li><strong>⚪ MONITOR</strong> — The bot is running but no triggers were met.</li>
        <li><strong>⚠️ SKIPPED</strong> — A trigger was met but conditions weren't right (e.g., low balance).</li>
      </ul>
    `,
    quiz: {
      question: "What does a 🔴 EXECUTE log entry mean?",
      options: [
        "The bot encountered an error",
        "The bot placed a sell order",
        "The bot is paused",
        "A new bot was created",
      ],
      correctIdx: 1,
    },
  },
];

function findBestLesson(query: string): LessonContent | null {
  const q = query.toLowerCase();
  const keywords: [RegExp, string][] = [
    [/order|book|bid|ask|spread/, "beg_intro"],
    [/candle|pattern|doji|hammer|engulf/, "int_candles"],
    [/rsi|overbought|oversold|momentum/, "int_rsi"],
    [/macd|crossover|convergence|divergence/, "int_macd"],
    [/grid|scalper|range|sideways/, "adv_grid"],
    [/risk|position|size|stop.?loss|diversif/, "adv_risk"],
    [/monitor|log|console|operation/, "adv_bot_ops"],
  ];
  for (const [pattern, id] of keywords) {
    if (pattern.test(q)) {
      return LESSONS.find((l) => l.id === id) ?? null;
    }
  }
  return null;
}

function getLearningPath(context: CoachContext): LessonContent[] {
  const completed = new Set(context.completedLessons);
  return LESSONS.filter((l) => {
    const prereqsMet = l.prerequisites.every((p) => completed.has(p));
    const alreadyDone = completed.has(l.id);
    return prereqsMet && !alreadyDone;
  });
}

function getNextLesson(context: CoachContext): LessonContent | null {
  const path = getLearningPath(context);
  const order = ["beg_intro", "int_candles", "int_rsi", "int_macd", "adv_grid", "adv_risk", "adv_bot_ops"];
  for (const id of order) {
    const lesson = path.find((l) => l.id === id);
    if (lesson) return lesson;
  }
  return null;
}

function generateGreeting(context: CoachContext): CoachResponse {
  const name = !context.completedLessons.length
    ? "Welcome to CryptoAcademy Pro! I'm your AI Trading Coach."
    : "Welcome back! Ready to continue your trading education?";

  const suggestions = ["What should I learn first?", "How do trading bots work?", "Explain RSI indicator", "Help me set up a bot"];

  return { message: name, suggestions };
}

function generateResponse(userMessage: string, context: CoachContext): CoachResponse {
  const msg = userMessage.toLowerCase().trim();

  if (/^(hi|hello|hey|start|begin)/.test(msg)) {
    return generateGreeting(context);
  }

  if (/what should i (learn|study|do) next|next lesson|continue/.test(msg)) {
    const next = getNextLesson(context);
    if (next) {
      return {
        message: `Your next recommended lesson is <strong>${next.title}</strong> (${next.category}, ${next.xpReward} XP). Ready to start?`,
        suggestions: [`Start ${next.title}`, "Show my learning path", "What other lessons are available?"],
        action: { type: "open_lesson", payload: next.id },
      };
    }
    return {
      message: "You've completed all available lessons! Try deploying a bot with your knowledge.",
      suggestions: ["Create a bot", "Review a lesson", "Reset demo account"],
      action: { type: "switch_tab", payload: "bots" },
    };
  }

  if (/lesson|academy|course|study|learn/.test(msg)) {
    const lessons = getLearningPath(context);
    if (lessons.length === 0) {
      return {
        message: "You've completed every lesson. You're ready for live trading concepts!",
        suggestions: ["Deploy a bot", "Practice manual trading", "Explore indicators"],
      };
    }
    const list = lessons
      .slice(0, 5)
      .map((l) => `<li><strong>${l.title}</strong> — ${l.category}, ${l.xpReward} XP</li>`)
      .join("");
    const next = lessons[0];
    return {
      message: `Here are your available lessons:<ul>${list}</ul>`,
      suggestions: [`Start "${next?.title ?? ""}"`, "Show completed lessons", "How many XP do I need for the next level?"],
      action: next ? { type: "open_lesson", payload: next.id } : undefined,
    };
  }

  if (/bot|strategy|automated|deploy|create.*bot/.test(msg)) {
    return {
      message: `I see you have <strong>${context.activeBotsCount}</strong> active bot${context.activeBotsCount !== 1 ? "s" : ""}. Here are the strategies available:
      <ul>
        <li><strong>RSI_BOT</strong> (Beginner) — Buys when RSI is oversold, sells when overbought. Best for ranging markets.</li>
        <li><strong>MACD_BOT</strong> (Intermediate) — Follows trend crossovers. Best for trending markets.</li>
        <li><strong>GRID_BOT</strong> (Advanced) — Places grid orders around a baseline. Best for sideways markets.</li>
      </ul>`,
      suggestions: ["Create an RSI bot", "Create a Grid bot", "Explain RSI strategy", "Explain Grid strategy"],
      action: { type: "open_bot_creator" },
    };
  }

  if (/rsi/.test(msg)) {
    const lesson = LESSONS.find((l) => l.id === "int_rsi");
    if (!lesson) return { message: "RSI lesson not found." };
    return {
      message: lesson.article,
      suggestions: ["Take the RSI quiz", "Create an RSI bot", "Explain MACD"],
      action: !context.completedLessons.includes("int_rsi")
        ? { type: "open_lesson", payload: "int_rsi" }
        : undefined,
    };
  }

  if (/take.*quiz|test me/i.test(msg)) {
    const bestLesson = findBestLesson(msg);
    if (bestLesson) {
      return {
        message: `Ready to test your knowledge on <strong>${bestLesson.title}</strong>? Open the lesson to take the quiz!`,
        suggestions: ["Open the lesson", "Review the material first", "Ask something else"],
        action: { type: "open_lesson", payload: bestLesson.id },
      };
    }
    return {
      message: "Which topic would you like to be quizzed on? Try asking about RSI, MACD, Grid, or Candlesticks.",
      suggestions: ["Explain RSI", "Explain MACD", "What should I learn next?"],
    };
  }

  if (/create.*bot|deploy.*bot|make.*bot/i.test(msg)) {
    return {
      message: "Let's set up a new trading bot! Head over to the Bots tab to configure one.",
      suggestions: ["Open bot creator", "Explain strategies", "What should I learn first?"],
      action: { type: "open_bot_creator" },
    };
  }

  if (/macd|crossover/.test(msg)) {
    const lesson = LESSONS.find((l) => l.id === "int_macd");
    if (!lesson) return { message: "MACD lesson not found." };
    return {
      message: lesson.article,
      suggestions: ["Take the MACD quiz", "Create an MACD bot", "Explain RSI"],
      action: !context.completedLessons.includes("int_macd")
        ? { type: "open_lesson", payload: "int_macd" }
        : undefined,
    };
  }

  if (/grid|scalp/.test(msg)) {
    const lesson = LESSONS.find((l) => l.id === "adv_grid");
    if (!lesson) return { message: "Grid trading lesson not found." };
    return {
      message: lesson.article,
      suggestions: ["Take the Grid quiz", "Create a Grid bot", "Explain risk management"],
      action: !context.completedLessons.includes("adv_grid")
        ? { type: "open_lesson", payload: "adv_grid" }
        : undefined,
    };
  }

  if (/risk|management|position|size|stop.?loss|diversif/.test(msg)) {
    const lesson = LESSONS.find((l) => l.id === "adv_risk");
    if (!lesson) return { message: "Risk management lesson not found." };
    return {
      message: lesson.article,
      suggestions: ["Take the Risk Management quiz", "Create a bot with good risk", "Explain bot operations"],
      action: !context.completedLessons.includes("adv_risk")
        ? { type: "open_lesson", payload: "adv_risk" }
        : undefined,
    };
  }

  if (/candle|pattern|doji|hammer|engulf/.test(msg)) {
    const lesson = LESSONS.find((l) => l.id === "int_candles");
    if (!lesson) return { message: "Candlestick lesson not found." };
    return {
      message: lesson.article,
      suggestions: ["Take the Candlestick quiz", "Explain RSI", "Explain Order Book"],
      action: !context.completedLessons.includes("int_candles")
        ? { type: "open_lesson", payload: "int_candles" }
        : undefined,
    };
  }

  if (/order.?book|bid|ask|spread|liquidity/.test(msg)) {
    const lesson = LESSONS.find((l) => l.id === "beg_intro");
    if (!lesson) return { message: "Order Book lesson not found." };
    return {
      message: lesson.article,
      suggestions: ["Take the Order Book quiz", "Explain Candlesticks", "What should I learn next?"],
      action: !context.completedLessons.includes("beg_intro")
        ? { type: "open_lesson", payload: "beg_intro" }
        : undefined,
    };
  }

  if (/balance|account|reset|money|portfolio|pnl|profit|loss/.test(msg)) {
    const pnl = context.portfolioValue - 10000;
    const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    return {
      message: `Here's your account summary:
      <ul>
        <li><strong>Balance</strong>: $${context.balance.toFixed(2)}</li>
        <li><strong>Portfolio Value</strong>: $${context.portfolioValue.toFixed(2)}</li>
        <li><strong>P&L</strong>: ${pnlStr}</li>
        <li><strong>Level</strong>: ${context.level} (${context.xp} XP)</li>
        <li><strong>Active Bots</strong>: ${context.activeBotsCount}</li>
      </ul>`,
      suggestions: ["Reset demo account", "Deploy a bot", "Learn about risk management"],
    };
  }

  if (/xp|level|progress|rank/.test(msg)) {
    const nextLevelXp =
      context.xp < 100 ? 100 : context.xp < 300 ? 300 : context.xp < 600 ? 600 : context.xp < 1000 ? 1000 : null;
    const remaining = nextLevelXp ? nextLevelXp - context.xp : 0;
    const pct = nextLevelXp ? Math.round((context.xp / nextLevelXp) * 100) : 100;
    return {
      message: `<strong>${context.level}</strong> — ${context.xp} total XP
      <div style="background:#262626;border-radius:8px;height:8px;margin:8px 0;overflow:hidden;">
        <div style="background:#3b82f6;width:${pct}%;height:100%;border-radius:8px;"></div>
      </div>
      ${nextLevelXp ? `${remaining} XP until next level` : "Maximum level reached! Master trader."}
      <p style="margin-top:8px;">Complete lessons and execute trades to earn XP.</p>`,
      suggestions: ["View available lessons", "Execute a trade", "Complete a lesson"],
    };
  }

  if (/help|what can you do|commands/.test(msg)) {
    return {
      message: `I can help you with:
      <ul>
        <li><strong>Learn</strong> — Ask about any topic: RSI, MACD, Grid trading, Order Book, Candlesticks, Risk Management</li>
        <li><strong>Track</strong> — "Show my balance", "What's my progress?", "Account summary"</li>
        <li><strong>Build</strong> — "Create a bot", "Explain strategies", "How do bots work?"</li>
        <li><strong>Guide</strong> — "What should I learn next?", "Start the tour", "Teach me to trade"</li>
      </ul>`,
      suggestions: ["What should I learn first?", "Show my account", "How do bots work?", "Start the tour"],
    };
  }

  if (/tour|guide|walkthrough|start|beginner/.test(msg)) {
    return {
      message: "Ready for a guided tour? I'll walk you through the trading arena step by step.",
      suggestions: ["Start the tour!", "What should I learn first?", "Skip to lessons"],
      action: { type: "start_tour" },
    };
  }

  if (/thank|thanks|great|awesome|perfect/.test(msg)) {
    return {
      message: "You're welcome! Keep learning and practicing. The more you trade (even in demo), the more XP you earn.",
      suggestions: ["What should I learn next?", "Check my progress", "Deploy a bot"],
    };
  }

  const bestLesson = findBestLesson(msg);
  if (bestLesson) {
    return {
      message: `I found a lesson that matches your question: <strong>${bestLesson.title}</strong>. Would you like to study it?`,
      suggestions: [`Open ${bestLesson.title}`, "Ask something else"],
      action: { type: "open_lesson", payload: bestLesson.id },
    };
  }

  return {
    message: `Great question! Here's what I recommend based on your level (<strong>${context.level}</strong>):
    <ul>
      <li>Check the <strong>Academy</strong> for structured lessons.</li>
      <li>Try the <strong>demo trading terminal</strong> to practice.</li>
      <li>Ask me about specific topics: RSI, MACD, Grid, Order Book, Risk Management.</li>
    </ul>`,
    suggestions: ["Show available lessons", "Explain RSI", "How do bots work?", "Check my account"],
  };
}

export function askCoach(userMessage: string, context: CoachContext): CoachResponse {
  return generateResponse(userMessage, context);
}

// Async version that tries rule-based first, then falls back to LLM
export async function askCoachWithLLM(
  userMessage: string,
  context: CoachContext,
  marketData: MarketData[]
): Promise<CoachResponse> {
  // Try rule-based first — it's instant and free
  const ruleBasedResponse = generateResponse(userMessage, context);

  // If rule-based matched a specific pattern (not the generic fallback), use it
  const isFallback =
    ruleBasedResponse.message.includes("Great question!") ||
    ruleBasedResponse.message.includes("I'm having trouble");
  
  console.log("[Coach] Rule-based matched:", !isFallback, "| Message:", ruleBasedResponse.message.substring(0, 60));
  
  if (!isFallback) {
    return ruleBasedResponse;
  }

  // If LLM is available, use it for general questions
  if (isLLMAvailable()) {
    console.log("[Coach] Calling LLM for question:", userMessage.substring(0, 50));
    const llmResponse = await askLLM(userMessage, context, marketData);
    if (llmResponse) {
      console.log("[Coach] LLM response received:", llmResponse.message.substring(0, 60));
      return {
        message: llmResponse.message,
        suggestions: llmResponse.suggestions,
        action: llmResponse.action,
      };
    }
    console.log("[Coach] LLM returned null, falling back to rule-based");
  } else {
    console.log("[Coach] LLM not available, using rule-based fallback");
  }

  // Final fallback — rule-based generic response
  return ruleBasedResponse;
}

export function getLessonById(id: string): LessonContent | undefined {
  return LESSONS.find((l) => l.id === id);
}

export function getAllLessons(): LessonContent[] {
  return [...LESSONS];
}

export function getUserProgress(context: CoachContext): {
  completedCount: number;
  totalCount: number;
  nextLesson: LessonContent | null;
  level: string;
  xpToNextLevel: number | null;
} {
  const totalCount = LESSONS.length;
  const completedCount = context.completedLessons.length;
  const nextLesson = getNextLesson(context);
  const thresholds = [100, 300, 600, 1000];
  const nextThreshold = thresholds.find((t) => t > context.xp) ?? null;
  return {
    completedCount,
    totalCount,
    nextLesson,
    level: context.level,
    xpToNextLevel: nextThreshold ? nextThreshold - context.xp : null,
  };
}
