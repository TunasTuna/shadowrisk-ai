import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from tavily import TavilyClient
from openai import OpenAI
import re
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
    "Supply chain": "supply chain disruption supplier shortage component dependency",
    "Legal": "lawsuit litigation investigation SEC probe fraud settlement",
    "Labor": "strike layoffs union dispute workforce reduction severance",
    "Regulatory": "regulation fine compliance enforcement ban tariff export control",
}

MAX_CHARS_PER_RESULT = 1500

SYSTEM_PROMPT = """You are a cynical forensic credit analyst. Assume companies
hide problems. Using ONLY the raw web data provided, write an institutional-grade
credit risk paper in Markdown with these sections:
1. Executive Summary
2. Supply Chain Risk
3. Legal Risk
4. Labor Risk
5. Regulatory Risk
6. Shadow Risk Score
7. Recommendation

Scoring rules for the Shadow Risk Score (0 = safe, 100 = distressed):
- Rate each category 0-100, then combine with these fixed weights:
  Supply chain 30%, Legal 25%, Labor 20%, Regulatory 25%.
- Show the table of ratings, weights and the weighted total.
- If the data is thin for a category, say so and rate it conservatively
  instead of inventing facts.

Evidence rules:
- Use only facts that appear in the data provided. Never add outside knowledge.
- Only state a date if it appears in the source text. Otherwise write "date unknown".
- The date of analysis is the "Today's date" given in the user message. Use it
  for the report header, and use it to judge whether events are recent or over.
- Prefer recent events over old ones, and do not blend events from different years.
- Treat events as ongoing only if a source dated within the last 12 months says
  so. Otherwise describe them in the past tense. Do not recommend waiting for an
  event that your sources show has already ended.
- Ignore job postings, social media posts, forum posts, and press releases from
  advocacy groups.
- Do not use law-firm "investigation" announcements or investor-recruitment
  press releases as evidence. Only use them if a news outlet independently
  confirms the same fact.
- If a category has no credible evidence left, say so.
- In every category table use exactly these columns:
  Evidence | Source and date | Interpretation
  Every row must have exactly 3 cells. The separator row must also have exactly
  3 cells: |---|---|---|

End the paper with this disclaimer in italics: "Automated analysis from public
web data. Not financial advice."

FINAL LINE RULE: after the disclaimer, the very last line of your entire response
must be plain text, with no asterisks, bold, italics or other formatting, exactly:
SHADOW_RISK_SCORE: NN
where NN is the final integer score from 0 to 100. Nothing after it."""


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

    # 1. Graceful Degradation: One failed topic shouldn't crash the whole audit
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

        # 2. Deduplication & Truncation: Prevents false confidence from repeated articles
        for r in res.get("results", []):
            url = r.get("url", "")
            if url in seen_urls:
                continue
            seen_urls.add(url)
            content = (r.get("content") or "")[:MAX_CHARS_PER_RESULT]
            chunks.append(f"[{label}] {r.get('title', '')} ({url})\n{content}")

    raw_text = "\n\n".join(chunks)

    # 3. Empty Context Guard: Prevents the LLM from hallucinating a report on zero data
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

    report = resp.choices[0].message.content or ""

    # 4. Robust Score Parsing: Line-based filtering prevents the score from leaking into the markdown
    match = re.search(r"SHADOW_RISK_SCORE:\s*(\d{1,3})", report, re.IGNORECASE)
    score = int(match.group(1)) if match else None
    if score is not None:
        score = max(0, min(100, score))

    # Strip any line containing the score marker to ensure clean markdown output
    report = "\n".join(
        line for line in report.splitlines()
        if "SHADOW_RISK_SCORE" not in line.upper()
    ).strip()

    return {"company": company, "score": score, "report": report}