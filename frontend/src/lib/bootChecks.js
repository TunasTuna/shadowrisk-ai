// Boot health probe. Confirms SEC EDGAR is reachable and reports a build
// version, then hands the result back to the dashboard status bar.
const EDGAR_PROBE_URL =
  "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany";
const PROBE_TIMEOUT_MS = 5000;

export async function runBootChecks(pushLog = () => {}) {
  const meta = {
    edgarOk: null,
    edgarAt: null,
    version: import.meta.env?.VITE_APP_VERSION || null,
  };

  pushLog("SYS", "BOOT_HEALTH: PROBING_EDGAR");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // no-cors: SEC EDGAR does not send CORS headers, so an opaque response is
    // expected. A resolved fetch means the endpoint is reachable.
    await fetch(EDGAR_PROBE_URL, {
      method: "GET",
      mode: "no-cors",
      signal: controller.signal,
    });
    meta.edgarOk = true;
  } catch {
    meta.edgarOk = false;
  } finally {
    clearTimeout(timer);
  }

  meta.edgarAt = new Date().toISOString();
  pushLog(
    meta.edgarOk ? "SYS_OK" : "WARN",
    `EDGAR_PROBE: ${meta.edgarOk ? "REACHABLE" : "UNREACHABLE"}`
  );
  return meta;
}
