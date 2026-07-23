/**
 * Sends issue reports by email.
 *
 * Option A — Resend (https://resend.com):
 *   RESEND_API_KEY=re_xxx
 *   EMAIL_FROM=Chatbot <noreply@kingdomcitizen.app>   // must be a verified domain/sender
 *   SUPPORT_TO_EMAIL=techsupport@kingdomcitizen.app
 *
 * Option B — SMTP (Google Workspace, Microsoft 365, Zoho, cPanel, etc.):
 *   SMTP_HOST=smtp.example.com
 *   SMTP_PORT=587
 *   SMTP_USER=...
 *   SMTP_PASS=...
 *   EMAIL_FROM=Chatbot <noreply@kingdomcitizen.app>
 *   SUPPORT_TO_EMAIL=techsupport@kingdomcitizen.app
 *
 * DRY_RUN=true logs instead of sending.
 */

/**
 * @param {object} payload
 * @returns {Promise<{ dryRun?: boolean, provider?: string, id?: string, to?: string }>}
 */
export async function sendSupportEmail(payload) {
  const to =
    process.env.SUPPORT_TO_EMAIL || "techsupport@kingdomcitizen.app";
  const from =
    process.env.EMAIL_FROM ||
    process.env.SMTP_USER ||
    "noreply@kingdomcitizen.app";
  const replyTo = payload.userEmail || undefined;
  const dryRun = process.env.DRY_RUN === "true";

  const subject = `[KC Support] ${payload.summary}`.slice(0, 200);
  const text = [
    "New issue report from the KC help chatbot",
    "",
    `Summary: ${payload.summary}`,
    `Details: ${payload.details || "(none)"}`,
    `User email: ${payload.userEmail || "(not provided)"}`,
    `Problem: ${payload.problemLabel || "(none)"} (${payload.problemId || "n/a"})`,
    `Page URL: ${payload.pageUrl || "(none)"}`,
    `Submitted at: ${payload.submittedAt}`,
  ].join("\n");

  if (dryRun) {
    console.log("[dry-run] Support email (not sent):", {
      to,
      from,
      replyTo,
      subject,
      text,
    });
    return { dryRun: true, to, subject };
  }

  if (process.env.RESEND_API_KEY) {
    return sendViaResend({ to, from, subject, text, replyTo });
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return sendViaSmtp({ to, from, subject, text, replyTo });
  }

  throw new Error(
    "Email is not configured. Set RESEND_API_KEY + EMAIL_FROM, or SMTP_HOST/SMTP_USER/SMTP_PASS + EMAIL_FROM on Render."
  );
}

export function isEmailConfigured() {
  if (process.env.RESEND_API_KEY) return true;
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  );
}

/**
 * @param {{ to: string, from: string, subject: string, text: string, replyTo?: string }} opts
 */
async function sendViaResend(opts) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Resend failed (${response.status}): ${JSON.stringify(body)}`
    );
  }
  return { provider: "resend", id: body.id, to: opts.to };
}

/**
 * @param {{ to: string, from: string, subject: string, text: string, replyTo?: string }} opts
 */
async function sendViaSmtp(opts) {
  const nodemailer = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const info = await transporter.sendMail({
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
  });

  return { provider: "smtp", id: info.messageId, to: opts.to };
}
