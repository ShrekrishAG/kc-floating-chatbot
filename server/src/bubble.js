/**
 * Forwards an issue report to a Bubble Backend Workflow (API Workflow).
 *
 * Env:
 * - BUBBLE_API_URL: full workflow URL, e.g.
 *   https://YOURAPP.bubbleapps.io/api/1.1/wf/create_support_issue
 * - BUBBLE_API_TOKEN: shared secret sent as Bearer or custom header
 * - BUBBLE_AUTH_HEADER: optional header name (default Authorization)
 * - DRY_RUN: if "true", log and skip the Bubble call (local demo)
 *
 * @param {object} payload
 */
export async function submitIssueToBubble(payload) {
  const dryRun = process.env.DRY_RUN === "true" || !process.env.BUBBLE_API_URL;

  if (dryRun) {
    console.log("[dry-run] Issue report (not sent to Bubble):", payload);
    return { dryRun: true, received: payload };
  }

  const url = process.env.BUBBLE_API_URL;
  const token = process.env.BUBBLE_API_TOKEN || "";
  const authHeader = process.env.BUBBLE_AUTH_HEADER || "Authorization";

  const headers = {
    "Content-Type": "application/json",
  };

  if (token) {
    if (authHeader.toLowerCase() === "authorization") {
      headers.Authorization = token.startsWith("Bearer ")
        ? token
        : `Bearer ${token}`;
    } else {
      headers[authHeader] = token;
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      summary: payload.summary,
      details: payload.details,
      user_email: payload.userEmail,
      page_url: payload.pageUrl,
      problem_id: payload.problemId,
      problem_label: payload.problemLabel,
      submitted_at: payload.submittedAt,
    }),
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `Bubble workflow returned ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`
    );
  }

  return { dryRun: false, status: response.status, body };
}
