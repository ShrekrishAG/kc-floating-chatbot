/**
 * Sends issue reports by email (optional image attachments).
 *
 * Attachments shape: [{ filename, contentType, content: Buffer }]
 *
 * Env: SENDGRID_API_KEY | RESEND_API_KEY | SMTP_* + EMAIL_FROM, SUPPORT_TO_EMAIL
 * DRY_RUN=true logs instead of sending.
 */

/**
 * @typedef {{ filename: string, contentType: string, content: Buffer }} EmailAttachment
 */

/**
 * @param {object} payload
 * @param {EmailAttachment[]} [attachments]
 * @returns {Promise<{ dryRun?: boolean, provider?: string, id?: string, to?: string, attachmentCount?: number }>}
 */
export async function sendSupportEmail(payload, attachments = []) {
  const to =
    process.env.SUPPORT_TO_EMAIL || "techsupport@kingdomcitizen.app";
  const from =
    process.env.EMAIL_FROM ||
    process.env.SMTP_USER ||
    "noreply@kingdomcitizen.app";
  const replyTo = payload.userEmail || undefined;
  const dryRun = process.env.DRY_RUN === "true";
  const files = Array.isArray(attachments) ? attachments : [];

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
    `Attachments: ${files.length ? files.map((f) => f.filename).join(", ") : "(none)"}`,
  ].join("\n");

  if (dryRun) {
    console.log("[dry-run] Support email (not sent):", {
      to,
      from,
      replyTo,
      subject,
      text,
      attachments: files.map((f) => ({
        filename: f.filename,
        contentType: f.contentType,
        bytes: f.content?.length || 0,
      })),
    });
    return { dryRun: true, to, subject, attachmentCount: files.length };
  }

  const mailOpts = { to, from, subject, text, replyTo, attachments: files };

  if (process.env.SENDGRID_API_KEY) {
    return sendViaSendGrid(mailOpts);
  }

  if (process.env.RESEND_API_KEY) {
    return sendViaResend(mailOpts);
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return sendViaSmtp(mailOpts);
  }

  throw new Error(
    "Email is not configured. Set SENDGRID_API_KEY + EMAIL_FROM, RESEND_API_KEY, or SMTP_* on Render."
  );
}

export function isEmailConfigured() {
  if (process.env.SENDGRID_API_KEY) return true;
  if (process.env.RESEND_API_KEY) return true;
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  );
}

/**
 * @param {string} from
 * @returns {{ email: string, name?: string }}
 */
function parseFrom(from) {
  const match = String(from).match(/^(.*)<([^>]+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, "");
    const email = match[2].trim();
    return name ? { email, name } : { email };
  }
  return { email: String(from).trim() };
}

/**
 * @param {{ to: string, from: string, subject: string, text: string, replyTo?: string, attachments?: EmailAttachment[] }} opts
 */
async function sendViaSendGrid(opts) {
  const from = parseFrom(opts.from);
  /** @type {Record<string, unknown>} */
  const body = {
    personalizations: [{ to: [{ email: opts.to }] }],
    from,
    subject: opts.subject,
    content: [{ type: "text/plain", value: opts.text }],
  };

  if (opts.replyTo) {
    body.reply_to = { email: opts.replyTo };
  }

  if (opts.attachments?.length) {
    body.attachments = opts.attachments.map((file) => ({
      content: Buffer.from(file.content).toString("base64"),
      filename: file.filename,
      type: file.contentType,
      disposition: "attachment",
    }));
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`SendGrid failed (${response.status}): ${errText}`);
  }

  const messageId = response.headers.get("x-message-id") || undefined;
  return {
    provider: "sendgrid",
    id: messageId,
    to: opts.to,
    attachmentCount: opts.attachments?.length || 0,
  };
}

/**
 * @param {{ to: string, from: string, subject: string, text: string, replyTo?: string, attachments?: EmailAttachment[] }} opts
 */
async function sendViaResend(opts) {
  /** @type {Record<string, unknown>} */
  const payload = {
    from: opts.from,
    to: [opts.to],
    subject: opts.subject,
    text: opts.text,
    ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
  };

  if (opts.attachments?.length) {
    payload.attachments = opts.attachments.map((file) => ({
      filename: file.filename,
      content: Buffer.from(file.content).toString("base64"),
    }));
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Resend failed (${response.status}): ${JSON.stringify(body)}`
    );
  }
  return {
    provider: "resend",
    id: body.id,
    to: opts.to,
    attachmentCount: opts.attachments?.length || 0,
  };
}

/**
 * @param {{ to: string, from: string, subject: string, text: string, replyTo?: string, attachments?: EmailAttachment[] }} opts
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
    attachments: (opts.attachments || []).map((file) => ({
      filename: file.filename,
      content: file.content,
      contentType: file.contentType,
    })),
  });

  return {
    provider: "smtp",
    id: info.messageId,
    to: opts.to,
    attachmentCount: opts.attachments?.length || 0,
  };
}
