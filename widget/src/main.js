import cssText from "./styles.css?inline";

function ensureStyles() {
  if (document.getElementById("kc-chatbot-styles")) return;
  const style = document.createElement("style");
  style.id = "kc-chatbot-styles";
  style.textContent = cssText;
  document.head.appendChild(style);
}

const ICON_CHAT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 0 0-1.4 1.4L10.6 12l-4.9 4.9a1 1 0 1 0 1.4 1.4L12 13.4l4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4z"/></svg>`;
const ICON_BACK = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M15.7 5.3a1 1 0 0 1 0 1.4L10.4 12l5.3 5.3a1 1 0 0 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0z"/></svg>`;

/**
 * @typedef {object} ChatbotConfig
 * @property {string} [apiBaseUrl]
 * @property {string} [title]
 * @property {string} [primaryColor]
 * @property {string} [userEmail]
 * @property {HTMLElement} [target]
 */

/**
 * @param {ChatbotConfig} [config]
 */
export function mountKCChatbot(config = {}) {
  ensureStyles();
  const existing = document.getElementById("kc-chatbot-root");
  if (existing) existing.remove();

  const apiBaseUrl = (config.apiBaseUrl ?? detectApiBase()).replace(/\/$/, "");
  const title = config.title || "Help";
  const primaryColor = config.primaryColor || "#1a5f4a";
  const defaultEmail = config.userEmail || "";

  /** @type {{ categories: Array<{ id: string, label: string, problems: Array<{ id: string, label: string }> }> } | null} */
  let kb = null;
  /** @type {"welcome"|"categories"|"problems"|"answer"|"escalate"|"form"|"done"} */
  let screen = "welcome";
  /** @type {{ id: string, label: string, problems: Array<{ id: string, label: string }> } | null} */
  let selectedCategory = null;
  /** @type {{ id: string, label: string, answer?: string } | null} */
  let selectedProblem = null;
  let open = false;
  let busy = false;
  let errorMsg = "";

  const root = document.createElement("div");
  root.id = "kc-chatbot-root";
  root.className = "kc-chatbot";
  root.style.setProperty("--kc-primary", primaryColor);
  root.style.setProperty(
    "--kc-primary-hover",
    shadeColor(primaryColor, -12)
  );
  (config.target || document.body).appendChild(root);

  function render() {
    root.innerHTML = "";

    if (open) {
      const panel = document.createElement("div");
      panel.className = "kc-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", title);

      const header = document.createElement("div");
      header.className = "kc-header";
      header.innerHTML = `<h2>${escapeHtml(title)}</h2>`;

      const actions = document.createElement("div");
      actions.className = "kc-header-actions";

      if (screen !== "welcome" && screen !== "done") {
        const back = document.createElement("button");
        back.type = "button";
        back.className = "kc-icon-btn";
        back.setAttribute("aria-label", "Back");
        back.innerHTML = ICON_BACK;
        back.addEventListener("click", goBack);
        actions.appendChild(back);
      }

      const close = document.createElement("button");
      close.type = "button";
      close.className = "kc-icon-btn";
      close.setAttribute("aria-label", "Close chat");
      close.innerHTML = ICON_CLOSE;
      close.addEventListener("click", () => {
        open = false;
        render();
      });
      actions.appendChild(close);
      header.appendChild(actions);
      panel.appendChild(header);

      const body = document.createElement("div");
      body.className = "kc-body";
      renderScreen(body);
      panel.appendChild(body);
      root.appendChild(panel);
    }

    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "kc-launcher";
    launcher.setAttribute("aria-label", open ? "Close help chat" : "Open help chat");
    launcher.innerHTML = open ? ICON_CLOSE : ICON_CHAT;
    launcher.addEventListener("click", () => {
      open = !open;
      if (open && !kb) loadKb();
      render();
    });
    root.appendChild(launcher);
  }

  /**
   * @param {HTMLElement} body
   */
  function renderScreen(body) {
    if (errorMsg) {
      const err = document.createElement("div");
      err.className = "kc-error";
      err.textContent = errorMsg;
      body.appendChild(err);
    }

    if (busy && !kb && screen === "welcome") {
      const loading = document.createElement("div");
      loading.className = "kc-loading";
      loading.textContent = "Loading help topics…";
      body.appendChild(loading);
      return;
    }

    switch (screen) {
      case "welcome":
        appendBot(
          body,
          "Hi! Select a topic below and we’ll show a quick answer from our help center."
        );
        appendChoices(
          body,
          (kb?.categories || []).map((c) => ({
            label: c.label,
            onClick: () => {
              selectedCategory = c;
              screen = "problems";
              errorMsg = "";
              render();
            },
          }))
        );
        appendChoices(body, [
          {
            label: "My problem isn’t listed",
            muted: true,
            onClick: () => {
              selectedProblem = null;
              screen = "escalate";
              errorMsg = "";
              render();
            },
          },
        ]);
        break;

      case "problems":
        appendBot(
          body,
          `You’re in “${selectedCategory?.label || "Topics"}”. What best describes the issue?`
        );
        appendChoices(
          body,
          (selectedCategory?.problems || []).map((p) => ({
            label: p.label,
            onClick: () => selectProblem(p),
          }))
        );
        appendChoices(body, [
          {
            label: "My problem isn’t listed",
            muted: true,
            onClick: () => {
              selectedProblem = null;
              screen = "escalate";
              errorMsg = "";
              render();
            },
          },
        ]);
        break;

      case "answer":
        appendUser(body, selectedProblem?.label || "");
        appendBot(body, selectedProblem?.answer || "No answer available.");
        appendBot(body, "Was this helpful?");
        appendActions(body, [
          {
            label: "Yes, thanks",
            primary: true,
            onClick: () => {
              screen = "done";
              errorMsg = "";
              render();
            },
          },
          {
            label: "No — submit a report",
            onClick: () => {
              screen = "escalate";
              errorMsg = "";
              render();
            },
          },
        ]);
        break;

      case "escalate":
        appendBot(
          body,
          "Would you like to submit an issue report for our support team?"
        );
        appendActions(body, [
          {
            label: "Yes, submit a report",
            primary: true,
            onClick: () => {
              screen = "form";
              errorMsg = "";
              render();
            },
          },
          {
            label: "No, go back",
            onClick: () => {
              screen = selectedProblem ? "answer" : selectedCategory ? "problems" : "welcome";
              errorMsg = "";
              render();
            },
          },
        ]);
        break;

      case "form":
        appendBot(
          body,
          selectedProblem?.requireReport
            ? "Please describe the problem below and submit an issue report for our support team."
            : "Describe the issue and we’ll send it to support. Fields marked * are required."
        );
        body.appendChild(buildForm());
        break;

      case "done":
        appendBot(
          body,
          selectedProblem
            ? "Glad that helped! You can close this chat anytime, or pick another topic."
            : "Your issue report was submitted. Our support team will follow up soon."
        );
        appendActions(body, [
          {
            label: "Browse topics again",
            primary: true,
            onClick: () => {
              selectedCategory = null;
              selectedProblem = null;
              screen = "welcome";
              errorMsg = "";
              render();
            },
          },
        ]);
        break;
    }
  }

  function buildForm() {
    const form = document.createElement("form");
    form.className = "kc-form";

    form.innerHTML = `
      <label>Summary *
        <input name="summary" required maxlength="500" placeholder="Short description of the issue" value="${escapeAttr(selectedProblem?.label || "")}" />
      </label>
      <label>Details
        <textarea name="details" rows="4" maxlength="5000" placeholder="What happened? Steps to reproduce?"></textarea>
      </label>
      <label>Email ${defaultEmail ? "" : "*"}
        <input name="userEmail" type="email" ${defaultEmail ? "" : "required"} maxlength="200" placeholder="you@example.com" value="${escapeAttr(defaultEmail)}" />
      </label>
      <div class="kc-actions"></div>
    `;

    const actions = form.querySelector(".kc-actions");
    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "kc-btn kc-btn-primary";
    submitBtn.textContent = busy ? "Submitting…" : "Submit report";
    submitBtn.disabled = busy;
    actions.appendChild(submitBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "kc-btn kc-btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      screen = "escalate";
      errorMsg = "";
      render();
    });
    actions.appendChild(cancelBtn);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;

      const data = new FormData(form);
      const summary = String(data.get("summary") || "").trim();
      const details = String(data.get("details") || "").trim();
      const userEmail = String(data.get("userEmail") || "").trim();

      if (!summary) {
        errorMsg = "Please enter a summary.";
        render();
        return;
      }

      busy = true;
      errorMsg = "";
      render();

      try {
        const res = await fetch(`${apiBaseUrl}/api/issues`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            summary,
            details,
            userEmail,
            pageUrl: typeof location !== "undefined" ? location.href : "",
            problemId: selectedProblem?.id || "",
            problemLabel: selectedProblem?.label || "",
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || `Request failed (${res.status})`);
        }
        screen = "done";
        selectedProblem = null;
      } catch (err) {
        errorMsg =
          err instanceof Error
            ? err.message
            : "Could not submit the report. Please try again.";
      } finally {
        busy = false;
        render();
      }
    });

    return form;
  }

  /**
   * @param {{ id: string, label: string, requireReport?: boolean }} problem
   */
  async function selectProblem(problem) {
    busy = true;
    errorMsg = "";
    selectedProblem = problem;
    render();
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/kb/${encodeURIComponent(problem.id)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load answer");
      selectedProblem = json;
      // Problems that always need support skip the FAQ answer and open the report form
      screen = json.requireReport ? "form" : "answer";
    } catch (err) {
      errorMsg =
        err instanceof Error ? err.message : "Failed to load answer.";
      selectedProblem = null;
      screen = "problems";
    } finally {
      busy = false;
      render();
    }
  }

  async function loadKb() {
    busy = true;
    errorMsg = "";
    render();
    try {
      const res = await fetch(`${apiBaseUrl}/api/kb`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load knowledge base");
      kb = json;
      screen = "welcome";
    } catch (err) {
      errorMsg =
        err instanceof Error
          ? err.message
          : "Could not load help topics.";
    } finally {
      busy = false;
      render();
    }
  }

  function goBack() {
    errorMsg = "";
    if (screen === "form") {
      screen = "escalate";
    } else if (screen === "escalate") {
      screen = selectedProblem ? "answer" : selectedCategory ? "problems" : "welcome";
    } else if (screen === "answer") {
      selectedProblem = null;
      screen = "problems";
    } else if (screen === "problems") {
      selectedCategory = null;
      screen = "welcome";
    } else {
      screen = "welcome";
    }
    render();
  }

  render();

  return {
    open: () => {
      open = true;
      if (!kb) loadKb();
      render();
    },
    close: () => {
      open = false;
      render();
    },
    destroy: () => root.remove(),
  };
}

function detectApiBase() {
  const script = document.currentScript;
  if (script && script instanceof HTMLScriptElement) {
    const fromData = script.dataset.apiUrl;
    if (fromData) return fromData.replace(/\/$/, "");
    try {
      return new URL(script.src).origin;
    } catch {
      /* ignore */
    }
  }
  const tag = document.querySelector("script[data-kc-chatbot][data-api-url]");
  if (tag instanceof HTMLScriptElement && tag.dataset.apiUrl) {
    return tag.dataset.apiUrl.replace(/\/$/, "");
  }
  return "";
}

/**
 * @param {HTMLElement} parent
 * @param {string} text
 */
function appendBot(parent, text) {
  const el = document.createElement("div");
  el.className = "kc-bubble kc-bubble-bot";
  el.textContent = text;
  parent.appendChild(el);
}

/**
 * @param {HTMLElement} parent
 * @param {string} text
 */
function appendUser(parent, text) {
  const el = document.createElement("div");
  el.className = "kc-bubble kc-bubble-user";
  el.textContent = text;
  parent.appendChild(el);
}

/**
 * @param {HTMLElement} parent
 * @param {Array<{ label: string, onClick: () => void, muted?: boolean }>} items
 */
function appendChoices(parent, items) {
  const wrap = document.createElement("div");
  wrap.className = "kc-choices";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kc-choice" + (item.muted ? " kc-choice-muted" : "");
    btn.textContent = item.label;
    btn.addEventListener("click", item.onClick);
    wrap.appendChild(btn);
  }
  parent.appendChild(wrap);
}

/**
 * @param {HTMLElement} parent
 * @param {Array<{ label: string, onClick: () => void, primary?: boolean }>} items
 */
function appendActions(parent, items) {
  const wrap = document.createElement("div");
  wrap.className = "kc-actions";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "kc-btn " + (item.primary ? "kc-btn-primary" : "kc-btn-secondary");
    btn.textContent = item.label;
    btn.addEventListener("click", item.onClick);
    wrap.appendChild(btn);
  }
  parent.appendChild(wrap);
}

/** @param {string} s */
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {string} s */
function escapeAttr(s) {
  return escapeHtml(s);
}

/** @param {string} hex @param {number} percent */
function shadeColor(hex, percent) {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return hex;
  const num = parseInt(raw, 16);
  let r = (num >> 16) + Math.round((percent / 100) * 255);
  let g = ((num >> 8) & 0xff) + Math.round((percent / 100) * 255);
  let b = (num & 0xff) + Math.round((percent / 100) * 255);
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function autoMountFromScript() {
  const scripts = document.querySelectorAll("script[data-kc-chatbot]");
  const script =
    scripts[scripts.length - 1] ||
    (document.currentScript instanceof HTMLScriptElement
      ? document.currentScript
      : null);

  if (!script || !(script instanceof HTMLScriptElement)) return;
  if (!script.hasAttribute("data-kc-chatbot") && !script.dataset.autoMount) {
    return;
  }

  mountKCChatbot({
    apiBaseUrl: script.dataset.apiUrl || detectApiBase(),
    title: script.dataset.title,
    primaryColor: script.dataset.primaryColor,
    userEmail: script.dataset.userEmail,
  });
}

if (typeof window !== "undefined") {
  window.KCChatbot = { mount: mountKCChatbot };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMountFromScript);
  } else {
    autoMountFromScript();
  }
}

