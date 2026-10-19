# 🛡️ ShadowRisk AI 
### Institutional-Grade Forensic Credit Intelligence

> *"Absence of evidence is not evidence of safety."*

ShadowRisk AI is an automated, institutional-grade credit risk analysis engine. It aggregates real-time market data, performs deep-web forensic scraping, and leverages advanced LLMs to generate brutal, evidence-based, 3-to-4-page credit risk papers complete with quantifiable risk scores and actionable institutional recommendations.

---

## 🚀 Key Features

- **📊 Real-Time Market Integration**: Fetches live financial metrics (Price, Market Cap, P/E, Beta, 52W Range) via `yfinance` to ground the LLM's analysis in current market realities.
- **🕸️ Deep Web Retrieval**: Utilizes Tavily Search to scrape up to 10 high-signal news/audit results per risk pillar (Supply Chain, Legal, Labor, Regulatory), filtering out noise and PR fluff.
- **🧠 Bulletproof LLM Pipeline**: 
  - 16,000-token output budget to prevent truncation of dense institutional reports.
  - Custom `_extract_json` parser with brace-matching logic.
  - **Self-Repair Retry Loop**: Automatically detects malformed/truncated JSON and feeds the partial output back to the model to guarantee a parseable response.
- **🖨️ Flawless PDF Export**: Dual-container architecture (`screen-only` vs `print-only`). Completely isolates the dark-mode terminal UI from a clean, light-mode, A4-portrait institutional PDF. Uses pure inline-CSS bar charts to prevent browser print-engine slicing.
- **🔄 Auto-Fallback Resilience**: Built-in provider fallback logic ensures demo continuity. If the primary LLM API hits rate limits, it seamlessly switches to a backup provider (e.g., OpenRouter) without crashing.

---

## 🏗️ Architecture & Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React, Vite, Tailwind CSS, ReactMarkdown |
| **Backend** | Python, FastAPI, Uvicorn |
| **Data & AI** | Tavily API, `yfinance`, OpenAI SDK (OpenRouter/Nebius compatible) |
| **DevOps** | Git, `.env` isolation, Auto-fallback routing |

---

## ⚙️ How It Works

1. **Input**: User enters a Company Name and optional Ticker Symbol (e.g., `Boeing`, `BA`).
2. **Market Data**: Backend instantly queries Yahoo Finance for live market metrics.
3. **Deep Scraping**: Tavily executes 4 targeted queries (Supply Chain, Legal, Labor, Regulatory), deduplicates URLs, and chunks the top results.
4. **LLM Synthesis**: The aggregated data + market context is fed to the LLM with a strict, cynical forensic analyst persona prompt.
5. **Self-Repair**: The backend validates the JSON output. If truncated, it auto-repairs.
6. **Rendering**: Frontend displays a Bloomberg-style terminal UI with a pure-CSS risk exposure chart and a dense markdown report.
7. **Export**: One-click PDF generation yields a clean, multi-page, boardroom-ready credit memo.

---

## 🛠️ Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+ & npm
- API Keys for [Tavily](https://tavily.com/) and an OpenAI-compatible provider (e.g., [Nebius](https://nebius.com/) or [OpenRouter](https://openrouter.ai/))

### 1. Clone the Repository
```bash
git clone https://github.com/TunasTuna/ShadowRisk-ai.git
cd ShadowRisk-ai
