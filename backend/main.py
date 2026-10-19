import os
import re
import json
import logging
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from tavily import TavilyClient
from openai import OpenAI
from datetime import date
import yfinance as yf

load_dotenv()

APP_LOGGER = logging.getLogger("shadowrisk")

# --- AUTO-FALLBACK LOGIC FOR LLM ---
primary_key = os.getenv("LLM_API_KEY", "")
if not primary_key or primary_key.startswith("your_") or "error" in primary_key.lower():
    print("[WARN] Primary LLM key missing/invalid. Falling back to OpenRouter...")
    os.environ["LLM_BASE_URL"] = "https://openrouter.ai/api/v1"
    os.environ["LLM_API_KEY"] = os.getenv("OPENROUTER_API_KEY", "")
    os.environ["LLM_MODEL"] = os.getenv("OPENROUTER_MODEL", "google/gemini-2.5-flash")

app = FastAPI(title="ShadowRisk AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

tavily = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))

llm = OpenAI(
    base_url=os.getenv("LLM_BASE_URL"),
    api_key=os.getenv("LLM_API_KEY"),
    default_headers={
        "HTTP-Referer": os.getenv("OPENROUTER_REFERER", "http://localhost:5173"),
        "X-Title": os.getenv("OPENROUTER_TITLE", "ShadowRisk AI"),
    }
)
MODEL = os.getenv("LLM_MODEL")

EXCLUDE_DOMAINS = [
    "facebook.com", "linkedin.com", "indeed.com", "glassdoor.com",
    "reddit.com", "x.com", "twitter.com", "youtube.com",
    "prnewswire.com", "globenewswire.com", "businesswire.com",
    "accessnewswire.com", "seekingalpha.com", "investing.com",
    "stocktitan.net", "marketbeat.com", "zacks.com",
]

TOPICS = {
    "Supply Chain": "supply chain disruption supplier shortage component dependency",
    "Legal": "lawsuit litigation investigation SEC probe fraud settlement",
    "Labor": "strike layoffs union dispute workforce reduction severance",
    "Regulatory": "regulation fine compliance enforcement ban tariff export control",
}

MAX_CHARS_PER_RESULT = 3000
MAX_OUTPUT_TOKENS = 16000
MAX_JSON_REPAIR_ATTEMPTS = 2

SYSTEM_PROMPT = """You are a cynical, institutional-grade forensic credit analyst. 
Output your response STRICTLY as a valid JSON object with exactly two keys: "report" (string) and "breakdown" (array).

The "report" value must be a brutal, evidence-based credit risk paper in Markdown, following this structure:
1. OPENING: An H1 header containing the company name, immediately followed by a single date-of-analysis line beneath it, then a horizontal rule separating the header block from the body.
2. EXECUTIVE SUMMARY: A tight 4-6 sentence Bottom Line Up Front (BLUF). It must name the primary existential threat, the cash-flow mechanism through which that threat transmits, and the stance.
3. RISK PILLARS: For each of the 4 categories, output a markdown table with exactly these headers: | Evidence | Source & Date | Credit Impact |
   - DEPTH: Each pillar must contain a minimum of 3 evidence rows wherever the raw data supports it. Only fall back to fewer rows if the retrieval genuinely contains less. Never pad with invented facts to hit the count.
   - "Credit Impact" must explain *why* this threatens cash flow, margins, or default risk.
   - If a pillar returns no adverse signals, the section must still exist and must state what was searched and what was absent, rather than a bare one-line dismissal.
   - Zero hallucination: every row must be grounded in the raw data provided. No invented facts, no hedging, no vague filler.
   - The report must be dense and institutional-grade. Target 3-4 pages when exported to PDF.
4. RECOMMENDATION: The recommendation word must be on its own line, bolded, as its own markdown element. Exactly one word: PASS, MONITOR, HIGH-YIELD ONLY, AVOID, or SHORT.
5. DISCLAIMER: A separate line below the recommendation, italicized, with a blank line between them. They must never share a line. Use: "*Automated analysis from public web data. Not financial advice.*"

Date-awareness: anchor every claim to its source date. Do not present stale evidence as current.

FINAL LINE RULE: The absolute last line of the "report" string must be plain-text SHADOW_RISK_SCORE: NN where NN is the integer 0-100. No formatting, no backticks, nothing after it.

The "breakdown" value must be an array of exactly 4 objects, formatted exactly like this:
[
  {"pillar": "Supply Chain", "score": 75, "color": "#06b6d4"},
  {"pillar": "Legal", "score": 65, "color": "#f59e0b"},
  {"pillar": "Labor", "score": 60, "color": "#a855f7"},
  {"pillar": "Regulatory", "score": 70, "color": "#ef4444"}
]
Scores must be integers 0-100. Colors must be exactly those hex codes.
Do not output any text outside the JSON object. No markdown code blocks (like ```json), just raw JSON."""


def get_stock_data(ticker: str):
    """Fetch stock market data from Yahoo Finance"""
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        
        return {
            "ticker": ticker,
            "name": info.get("longName", ticker),
            "price": info.get("currentPrice") or info.get("regularMarketPrice"),
            "market_cap": info.get("marketCap"),
            "pe_ratio": info.get("trailingPE"),
            "dividend_yield": info.get("dividendYield"),
            "52w_high": info.get("fiftyTwoWeekHigh"),
            "52w_low": info.get("fiftyTwoWeekLow"),
            "avg_volume": info.get("averageVolume"),
            "beta": info.get("beta"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
        }
    except Exception as e:
        APP_LOGGER.warning(f"Yahoo Finance error for {ticker}: {e}")
        return None


class AnalyzeRequest(BaseModel):
    company: str
    ticker: str = None  # <-- ADDED TICKER


def _call_llm(messages, *, json_mode=True, max_tokens=MAX_OUTPUT_TOKENS):
    """Single LLM completion against the configured OpenAI-compatible endpoint."""
    kwargs = {
        "model": MODEL,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": max_tokens,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    resp = llm.chat.completions.create(**kwargs)
    return (resp.choices[0].message.content or "").strip()


def _extract_json(text):
    """Tolerantly pull a complete JSON object out of a model response."""
    if not text:
        return None
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_str = False
    escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                candidate = text[start : i + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    return None
    return None


def _llm_report_payload(company, raw_text, context_note, stock_context):
    """Obtain the model's JSON payload, retrying once with a repair prompt if the output was truncated or otherwise malformed."""
    first_try = _call_llm(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Today's date: {date.today().isoformat()}\n"
                    f"Company: {company}\n"
                    f"{stock_context}\n\n"  # <-- INJECTED STOCK CONTEXT
                    f"Raw data:\n{raw_text}{context_note}"
                ),
            },
        ]
    )
    parsed = _extract_json(first_try)
    if parsed is not None:
        return parsed

    for attempt in range(1, MAX_JSON_REPAIR_ATTEMPTS + 1):
        APP_LOGGER.warning(
            "LLM payload unparseable (repair attempt %d/%d)", attempt, MAX_JSON_REPAIR_ATTEMPTS
        )
        repaired = _call_llm(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Today's date: {date.today().isoformat()}\n"
                        f"Company: {company}\n"
                        f"{stock_context}\n\n"
                        "Your previous output was truncated or malformed. "
                        "Return the COMPLETE, valid JSON object now — every string value must be "
                        "fully closed, every table rendered, no analysis left unfinished, and no "
                        "text outside the JSON object.\n\n"
                        f"Raw data:\n{raw_text}{context_note}\n\n"
                        f"Partial/previous output:\n{first_try}"
                    ),
                },
            ]
        )
        parsed = _extract_json(repaired)
        if parsed is not None:
            return parsed
        first_try = repaired

    raise ValueError(
        "model returned unparseable output after consistent retries (truncated / malformed JSON)"
    )


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    company = req.company.strip()
    ticker = req.ticker.strip().upper() if req.ticker else None  # <-- ADDED TICKER HANDLING
    
    if not company:
        raise HTTPException(status_code=400, detail="Company name required")

    # Fetch stock data if ticker provided
    stock_data = get_stock_data(ticker) if ticker else None
    
    # Build stock context for LLM
    stock_context = ""
    if stock_data:
        stock_context = f"""
Market Data for {stock_data['name']} ({ticker}):
- Current Price: ${stock_data['price']}
- Market Cap: ${stock_data['market_cap']:,}
- P/E Ratio: {stock_data['pe_ratio']}
- 52-Week Range: ${stock_data['52w_low']} - ${stock_data['52w_high']}
- Beta: {stock_data['beta']}
- Sector: {stock_data['sector']}
- Industry: {stock_data['industry']}
"""

    chunks = []
    seen_urls = set()
    failed_topics = []

    for label, terms in TOPICS.items():
        try:
            res = tavily.search(
                query=f"{company} {terms}",
                topic="news",
                time_range="year",
                max_results=10,
                exclude_domains=EXCLUDE_DOMAINS,
            )
        except Exception as e:
            failed_topics.append(f"{label}: {e}")
            continue

        for r in res.get("results", []):
            url = r.get("url", "")
            if url in seen_urls:
                continue
            seen_urls.add(url)
            content = (r.get("content") or "")[:MAX_CHARS_PER_RESULT]
            chunks.append(f"[{label}] {r.get('title', '')} ({url})\n{content}")

    print(f"[DEBUG] Retrieved {len(chunks)} total chunks across {len(TOPICS)} topics")

    raw_text = "\n\n".join(chunks)

    if not raw_text.strip():
        return {
            "company": company,
            "score": 50,
            "report": (
                f"# ALTERNATIVE CREDIT AUDIT: {company.upper()}\n\n"
                "**Shadow Risk Score:** 50 (UNRATED)\n\n"
                "## Evidence Status\n"
                "NO ADVERSE SIGNALS RETRIEVED IN CURRENT SCRAPE. "
                "Insufficient corroborated public news data to underwrite. "
                "Absence of evidence is not evidence of safety.\n\n"
                "*Automated analysis from public web data. Not financial advice.*"
            ),
            "breakdown": [
                {"pillar": "Supply Chain", "score": 50, "color": "#06b6d4"},
                {"pillar": "Legal", "score": 50, "color": "#f59e0b"},
                {"pillar": "Labor", "score": 50, "color": "#a855f7"},
                {"pillar": "Regulatory", "score": 50, "color": "#ef4444"}
            ],
            "stock_data": stock_data  # <-- ADDED TO RETURN
        }

    context_note = ""
    if failed_topics:
        context_note = (
            "\n\nNOTE: These pillars returned no retrieval this run: "
            + ", ".join(t.split(":")[0] for t in failed_topics)
            + ". Mark them NO DATA RETRIEVED. Do not rate them from memory."
        )

    try:
        result = _llm_report_payload(company, raw_text, context_note, stock_context)
    except Exception as e:
        APP_LOGGER.exception("LLM did not yield a parseable payload")
        raise HTTPException(status_code=502, detail=f"LLM failed to output valid JSON: {e}")

    report = result.get("report", "")
    breakdown = result.get("breakdown", [])

    weights = {"Supply Chain": 0.30, "Legal": 0.25, "Labor": 0.20, "Regulatory": 0.25}
    total_score = 0
    for item in breakdown:
        pillar = item.get("pillar", "")
        score = item.get("score", 0)
        w = weights.get(pillar, 0.25)
        total_score += score * w

    score = round(total_score)

    return {
        "company": company, 
        "score": score, 
        "report": report, 
        "breakdown": breakdown,
        "stock_data": stock_data  # <-- ADDED TO RETURN
    }