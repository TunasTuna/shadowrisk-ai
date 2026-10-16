const runAnalysis = async (event) => {
    event?.preventDefault();
    const target = query.trim().toUpperCase();
    if (!target || status === "running") return;

    setEntity(target);
    setMarkdown("");
    setStatus("running");
    pushLog("SYS", `QUERY_DISPATCH: ${target}`);
    pushLog("NET", `SEC_SCRAPE_INIT: ${target}`);

    try {
      // MATCHES YOUR MAIN.PY ENDPOINT
      const response = await fetch('http://127.0.0.1:8000/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // MATCHES YOUR PYDANTIC MODEL (company, not ticker)
        body: JSON.stringify({ company: target })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      // MATCHES YOUR RETURN PAYLOAD
      setMarkdown(data.report); 
      setStatus("ready");
      pushLog("SYS_OK", `RENDER_COMPLETE: ${target} (Score: ${data.score}/100)`);
      setSources((prev) => ({ ...prev, lastAuditAt: new Date().toISOString() }));
      
    } catch (err) {
      setStatus("idle");
      pushLog("ERR", `CONNECTION_REFUSED: ${err.message}`);
    }
  };