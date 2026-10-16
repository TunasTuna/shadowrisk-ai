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

TOPICS = {
    "Supply chain": "supply chain disruption shortage",
    "Legal": "lawsuit litigation investigation fraud",
    "Labor": "strike layoffs union labor dispute",
    "Regulatory": "regulation fine compliance government",
}

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
    try:
        for label, terms in TOPICS.items():
            res = tavily.search(
                query=f"{company} {terms}",
                topic="news",
                time_range="year",
                max_results=5,
                exclude_domains=["facebook.com", "linkedin.com", "indeed.com", "boeing.com",
                 "reddit.com", "prnewswire.com", "globenewswire.com",
                 "businesswire.com", "accessnewswire.com"],
            )
            for r in res.get("results", []):
                chunks.append(f"[{label}] {r['title']} ({r['url']})\n{r['content']}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Tavily error: {e}")

    raw_text = "\n\n".join(chunks)

    try:
        resp = llm.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Today's date: {date.today().isoformat()}\nCompany: {company}\n\nRaw data:\n{raw_text}"},
            ],
            temperature=0.1,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")

    report = resp.choices[0].message.content

    match = re.search(r"SHADOW_RISK_SCORE:\s*(\d{1,3})", report)
    score = int(match.group(1)) if match else None
    report = re.sub(r"\n+[*_\s]*SHADOW_RISK_SCORE:\s*\d{1,3}[*_\s]*$", "", report).strip()

    return {"company": company, "score": score, "report": report}