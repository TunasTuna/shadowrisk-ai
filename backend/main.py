import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from tavily import TavilyClient
from openai import OpenAI
from datetime import date

load_dotenv()

app = FastAPI(title="ShadowRisk AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

tavily = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
llm = OpenAI(
    base_url=os.getenv("NEBIUS_BASE_URL"),
    api_key=os.getenv("NEBIUS_API_KEY"),
)
MODEL = os.getenv("NEBIUS_MODEL")

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

MAX_CHARS_PER_RESULT = 1500

SYSTEM_PROMPT = """You are a cynical, institutional-grade forensic credit analyst. 
Output your response STRICTLY as a valid JSON object with exactly two keys: "report" (string) and "breakdown" (array).

The "report" value must be a brutal, evidence-based credit risk paper in Markdown, following this structure:
1. EXECUTIVE SUMMARY: Max 3 sentences. Bottom Line Up Front (BLUF).
2. RISK PILLARS: For each of the 4 categories, output a markdown table with exactly these headers: | Evidence | Source & Date | Credit Impact |
   - "Credit Impact" must explain *why* this threatens cash flow, margins, or default risk.
   - If no credible negative evidence, output: "NO ADVERSE SIGNALS RETRIEVED. Absence of evidence is not evidence of safety."
3. RECOMMENDATION: Exactly one word on its own line: PASS, MONITOR, HIGH-YIELD ONLY, AVOID, or SHORT.
4. End with: "*Automated analysis from public web data. Not financial advice.*"

The "breakdown" value must be an array of exactly 4 objects, formatted exactly like this:
[
  {"pillar": "Supply Chain", "score": 75, "color": "#06b6d4"},
  {"pillar": "Legal", "score": 65, "color": "#f59e0b"},
  {"pillar": "Labor", "score": 60, "color": "#a855f7"},
  {"pillar": "Regulatory", "score": 70, "color": "#ef4444"}
]
Scores must be integers 0-100. Colors must be exactly those hex codes.
Do not output any text outside the JSON object. No markdown code blocks (like ```json), just raw JSON."""


class AnalyzeRequest(BaseModel):
    company: str


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    company = req.company.strip()
    if not company:
        raise HTTPException(status_code=400, detail="Company name required")

    chunks = []
    seen_urls = set()
    failed_topics = []

    # 1. Graceful Degradation
    for label, terms in TOPICS.items():
        try:
            res = tavily.search(
                query=f"{company} {terms}",
                topic="news",
                time_range="year",
                max_results=5,
                exclude_domains=EXCLUDE_DOMAINS,
            )
        except Exception as e:
            failed_topics.append(f"{label}: {e}")
            continue

        # 2. Deduplication & Truncation
        for r in res.get("results", []):
            url = r.get("url", "")
            if url in seen_urls:
                continue
            seen_urls.add(url)
            content = (r.get("content") or "")[:MAX_CHARS_PER_RESULT]
            chunks.append(f"[{label}] {r.get('title', '')} ({url})\n{content}")

    raw_text = "\n\n".join(chunks)

    # 3. Empty Context Guard
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
            ]
        }

    context_note = ""
    if failed_topics:
        context_note = (
            "\n\nNOTE: These pillars returned no retrieval this run: "
            + ", ".join(t.split(":")[0] for t in failed_topics)
            + ". Mark them NO DATA RETRIEVED. Do not rate them from memory."
        )

    try:
        resp = llm.chat.completions.create(
            model=MODEL,
            response_format={"type": "json_object"},  # <-- FORCES VALID JSON
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": (
                    f"Today's date: {date.today().isoformat()}\n"
                    f"Company: {company}\n\nRaw data:\n{raw_text}{context_note}"
                )},
            ],
            temperature=0.1,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")

    # 4. Safe JSON Parsing & Backend Math Calculation
    try:
        result = json.loads(resp.choices[0].message.content)
        report = result.get("report", "")
        breakdown = result.get("breakdown", [])
        
        # Calculate weighted score on the backend to guarantee 100% math accuracy
        weights = {"Supply Chain": 0.30, "Legal": 0.25, "Labor": 0.20, "Regulatory": 0.25}
        total_score = 0
        for item in breakdown:
            pillar = item.get("pillar", "")
            score = item.get("score", 0)
            w = weights.get(pillar, 0.25)
            total_score += score * w
        
        score = round(total_score)
        
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"LLM failed to output valid JSON: {e}")

    return {"company": company, "score": score, "report": report, "breakdown": breakdown}