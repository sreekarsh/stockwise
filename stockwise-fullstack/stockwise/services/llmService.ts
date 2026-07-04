import OpenAI from "openai";
import { env } from "../config/env.js";
import type { CoachContext } from "./aiCoachService.js";

const GITHUB_TOKEN = env.GITHUB_TOKEN;
const GEMINI_KEY = env.GEMINI_API_KEY;
const OPENAI_KEY = env.OPENAI_API_KEY;

console.log("[LLM] GitHub token:", GITHUB_TOKEN ? "Set" : "NOT SET");
console.log("[LLM] Gemini key:", GEMINI_KEY ? "Set" : "NOT SET");
console.log("[LLM] OpenAI key:", OPENAI_KEY ? "Set" : "NOT SET");

export interface MarketData {
  symbol: string;
  name: string;
  priceUsd: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
}

interface LLMResponse {
  message: string;
  suggestions?: string[];
  action?: {
    type: "switch_tab" | "open_lesson" | "open_bot_creator" | "start_tour";
    payload?: string;
  };
}

function buildSystemPrompt(context: CoachContext, marketData: MarketData[]): string {
  const marketLines = marketData
    .map(
      (m) =>
        `  ${m.symbol} (${m.name}): $${m.priceUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | 24h: ${m.change24h >= 0 ? "+" : ""}${m.change24h.toFixed(2)}% | Vol: $${(m.volume24h / 1e9).toFixed(2)}B | MCap: $${(m.marketCap / 1e9).toFixed(1)}B`
    )
    .join("\n");

  const lessonSummary = `Available lessons (return action with type "open_lesson" and payload lesson id when user wants to start one):
  - beg_intro: Cryptocurrency & Order Book 101 (Beginner, 50 XP)
  - int_candles: Reading Candlestick Patterns (Beginner, 75 XP)
  - int_rsi: Indicator Study: RSI (Intermediate, 75 XP)
  - int_macd: MACD & Trend Following (Intermediate, 75 XP)
  - adv_grid: Understanding Grid Trading Bots (Advanced, 100 XP)
  - adv_risk: Risk Management & Position Sizing (Advanced, 100 XP)
  - adv_bot_ops: Bot Operations & Monitoring (Advanced, 75 XP)`;

  const pnl = context.portfolioValue - 10000;
  const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;

  return `You are an expert crypto trading coach and AI assistant for StockWise, a demo cryptocurrency trading platform. You are knowledgeable, friendly, and concise. You help users learn trading concepts, analyze the market, manage their portfolio, and use the platform.

## USER CONTEXT
- Balance: $${context.balance.toFixed(2)}
- Portfolio Value: $${context.portfolioValue.toFixed(2)}
- P&L: ${pnlStr}
- Level: ${context.level} (${context.xp} XP)
- Active Bots: ${context.activeBotsCount}
- Completed Lessons: ${context.completedLessons.length > 0 ? context.completedLessons.join(", ") : "None yet"}

## LIVE MARKET DATA (real-time prices)
${marketLines}

## PLATFORM FEATURES
- **Trading Arena**: Practice trading with $10,000 virtual funds. Buy/sell crypto with leverage (up to 20x).
- **Automated Bots**: RSI_BOT (oversold/overbought), MACD_BOT (trend following), GRID_BOT (sideways markets).
- **Academy**: Structured lessons with quizzes to earn XP and level up.
- **Portfolio Tracker**: Track holdings, P&L, and performance.
- **Order Book**: Real-time simulated order book with bid/ask spread.

${lessonSummary}

## RESPONSE RULES
1. Be concise and helpful. Use HTML formatting (<strong>, <ul>, <li>, <p>) for readability when needed.
2. When users ask about prices, ALWAYS use the live market data provided above. Never fabricate prices.
3. When users ask about lessons or learning, suggest the appropriate lesson and include an action if they want to start it.
4. When users ask about their account/portfolio/bots, use the user context data.
5. When users ask general trading questions (e.g., "what is leverage?", "how do stop losses work?"), answer from your expertise.
6. When users ask about platform features, explain how to use them.
7. If you're unsure about something, say so honestly rather than guessing.
8. You can recommend specific actions:
   - To open a lesson: include action { type: "open_lesson", payload: "lesson_id" }
   - To open bot creator: include action { type: "open_bot_creator" }
   - To start guided tour: include action { type: "start_tour" }
   - To switch tabs: include action { type: "switch_tab", payload: "tab_name" }
9. Always provide 2-4 relevant suggestion buttons (short strings users can click to follow up).
10. For complex analysis, use markdown-style formatting with headers and bullet points.

## IMPORTANT
- Return your response as valid JSON with this exact shape:
  { "message": "your HTML response", "suggestions": ["suggestion1", "suggestion2"], "action": { "type": "action_type", "payload": "optional_payload" } }
- If no action is needed, omit the "action" field.
- The "message" field can contain HTML tags for formatting.
- Keep responses under 500 words for readability.`;
}

function parseLLMResponse(raw: string): LLMResponse | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const response: LLMResponse = {
      message: parsed.message || parsed.response || parsed.text || raw,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 4) : undefined,
    };
    if (parsed.action && typeof parsed.action === "object" && parsed.action.type) {
      const validTypes = ["switch_tab", "open_lesson", "open_bot_creator", "start_tour"];
      if (validTypes.includes(parsed.action.type)) {
        response.action = { type: parsed.action.type, payload: parsed.action.payload };
      }
    }
    return response;
  } catch {
    return { message: raw };
  }
}

function buildChatMessages(userMessage: string, context: CoachContext, marketData: MarketData[]) {
  return [
    { role: "system" as const, content: buildSystemPrompt(context, marketData) },
    { role: "user" as const, content: userMessage },
  ];
}

async function callOpenAICompatible(
  label: string,
  messages: { role: "system" | "user"; content: string }[],
  client: OpenAI,
): Promise<LLMResponse | null> {
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages,
      temperature: 0.7,
      max_tokens: 800,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      console.log(`[LLM] Empty response from ${label}`);
      return null;
    }
    console.log(`[LLM] ${label} response received:`, raw.substring(0, 80));
    return parseLLMResponse(raw);
  } catch (err: any) {
    console.error(`[LLM] ${label} error:`, err?.message || err);
    return null;
  }
}

async function callGitHub(userMessage: string, context: CoachContext, marketData: MarketData[]): Promise<LLMResponse | null> {
  if (!GITHUB_TOKEN) return null;
  const client = new OpenAI({
    baseURL: "https://models.inference.ai.azure.com",
    apiKey: GITHUB_TOKEN,
  });
  console.log("[LLM] Calling GitHub Models (GPT-4o) with message:", userMessage.substring(0, 50));
  return callOpenAICompatible("GitHub Models", buildChatMessages(userMessage, context, marketData), client);
}

async function callOpenAI(userMessage: string, context: CoachContext, marketData: MarketData[]): Promise<LLMResponse | null> {
  if (!OPENAI_KEY) return null;
  const client = new OpenAI({ apiKey: OPENAI_KEY });
  console.log("[LLM] Calling OpenAI GPT-4o with message:", userMessage.substring(0, 50));
  return callOpenAICompatible("OpenAI", buildChatMessages(userMessage, context, marketData), client);
}

async function callGemini(userMessage: string, context: CoachContext, marketData: MarketData[]): Promise<LLMResponse | null> {
  if (!GEMINI_KEY) return null;
  const prompt = `${buildSystemPrompt(context, marketData)}\n\nUser: ${userMessage}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
  // Note: Gemini API key is passed as query param per Google's documented auth method.
  try {
    console.log("[LLM] Calling Gemini with message:", userMessage.substring(0, 50));
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`[LLM] Gemini error ${resp.status}:`, errText.substring(0, 150));
      return null;
    }
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.log("[LLM] Empty response from Gemini");
      return null;
    }
    console.log("[LLM] Gemini response received:", text.substring(0, 80));
    return parseLLMResponse(text);
  } catch (err: any) {
    console.error("[LLM] Gemini error:", err?.message || err);
    return null;
  }
}

export async function askLLM(
  userMessage: string,
  context: CoachContext,
  marketData: MarketData[]
): Promise<LLMResponse | null> {
  let response: LLMResponse | null = null;

  // Try GitHub Models first (free with GitHub PAT — no credit card)
  if (GITHUB_TOKEN) {
    response = await callGitHub(userMessage, context, marketData);
    if (response) return response;
    console.log("[LLM] GitHub Models unavailable, trying Gemini...");
  }

  // Then Gemini (free tier, 60 RPM)
  if (GEMINI_KEY) {
    response = await callGemini(userMessage, context, marketData);
    if (response) return response;
    console.log("[LLM] Gemini unavailable, trying OpenAI...");
  }

  // Last: OpenAI
  if (OPENAI_KEY) {
    response = await callOpenAI(userMessage, context, marketData);
    if (response) return response;
  }

  return null;
}

export function isLLMAvailable(): boolean {
  return !!(GITHUB_TOKEN || GEMINI_KEY || OPENAI_KEY);
}

export function getActiveProvider(): string {
  if (GITHUB_TOKEN) return "GitHub Models (free)";
  if (GEMINI_KEY) return "Gemini 2.0 Flash (free)";
  if (OPENAI_KEY) return "GPT-4o";
  return "none";
}
