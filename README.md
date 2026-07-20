# KC Floating Knowledge-Base Chatbot

Standalone floating chat widget + API for Bubble web/mobile apps. Users pick a problem, get a knowledge-base answer, and can submit an issue report to your Bubble support inbox when nothing matches.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

- API: http://localhost:3000  
- Widget preview: http://localhost:5173  

With `DRY_RUN=true` (default in `.env.example`), issue reports are logged on the server and **not** sent to Bubble.

### Production-style local run

```bash
npm run build
# serves API + built widget from the same origin
DRY_RUN=true npm start
```

Then open http://localhost:3000/ for a demo page, or embed with `apiBaseUrl` pointing at `http://localhost:3000`.

## Project layout

| Path | Role |
|------|------|
| `knowledge/knowledge-base.json` | Categories, problems, answers (edit anytime) |
| `server/` | Express API (`/api/kb`, `/api/issues`) |
| `widget/` | Floating chat UI (Vite) |

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/kb` | Categories + problem labels |
| `GET` | `/api/kb/:problemId` | Full answer for one problem |
| `POST` | `/api/issues` | Submit issue report → Bubble workflow |

### `POST /api/issues` body

```json
{
  "summary": "Cannot reset password",
  "details": "Reset email never arrives",
  "userEmail": "user@example.com",
  "pageUrl": "https://your-bubble-app.com/settings",
  "problemId": "reset-password",
  "problemLabel": "I forgot my password"
}
```

## Embed in Bubble

1. Deploy this API (and built widget) to a host with HTTPS (Railway, Render, Fly, etc.).
2. In Bubble, add an **HTML** element on the page (or reusable header) with:

```html
<script
  src="https://YOUR_API_HOST/widget.js"
  data-kc-chatbot
  data-api-url="https://YOUR_API_HOST"
  data-title="Help"
  data-primary-color="#1a5f4a"
  defer
></script>
```

Optional: pass the logged-in user’s email from Bubble:

```html
<script
  src="https://YOUR_API_HOST/widget.js"
  data-kc-chatbot
  data-api-url="https://YOUR_API_HOST"
  data-user-email="Current User's email"
  defer
></script>
```

(In Bubble’s HTML element, insert the dynamic email expression where `Current User's email` is shown.)

3. Set `CORS_ORIGINS` in `.env` to your Bubble app origin(s), comma-separated, e.g.  
   `https://your-app.bubbleapps.io,https://www.yourdomain.com`

## Connect issue reports to Bubble

Bubble’s **API Connector** plugin calls *out* to external APIs. For filing tickets from this chatbot, your **server calls into Bubble** via a **Backend Workflow** (API Workflow).

### 1. Data type

Create a data type, e.g. `SupportIssue`, with fields:

- `summary` (text)
- `details` (text)
- `user_email` (text)
- `page_url` (text)
- `problem_id` (text)
- `problem_label` (text)
- `submitted_at` (date) — or use Bubble’s Created Date
- `status` (text), default `"new"`

### 2. Backend workflow

1. Enable **Backend workflows** in Bubble settings.
2. Create workflow `create_support_issue`.
3. Check **Expose as a public API workflow**.
4. Add parameters matching the JSON keys your server sends:  
   `summary`, `details`, `user_email`, `page_url`, `problem_id`, `problem_label`, `submitted_at`.
5. Action: **Create a new SupportIssue…** mapping those parameters.
6. Secure it: require a privacy rule / ignore privacy rules carefully, and validate a shared token (parameter or header) in the workflow.

Workflow URL shape:

```text
https://YOURAPP.bubbleapps.io/api/1.1/wf/create_support_issue
```

(Use your custom domain if the app is live on one.)

### 3. Server env

```env
DRY_RUN=false
BUBBLE_API_URL=https://YOURAPP.bubbleapps.io/api/1.1/wf/create_support_issue
BUBBLE_API_TOKEN=your-shared-secret
BUBBLE_AUTH_HEADER=Authorization
```

Restart the server after changing `.env`.

### Optional: Bubble API Connector → this API

If you want Bubble workflows to call *your* chatbot API (e.g. refresh topics elsewhere in the app):

1. Install **API Connector**.
2. Add an API call: `GET https://YOUR_API_HOST/api/kb`.
3. Initialize the call and use the response in Bubble workflows/elements as needed.

This is optional; the floating widget does not need API Connector to work.

## Editing the knowledge base

Edit `knowledge/knowledge-base.json`. The server reloads it when the file changes (no restart required for KB content). Keep `id` values unique across all problems.

## Mobile (Bubble)

Use the same HTML embed wherever your Bubble mobile builder allows custom HTML. If HTML embeds are limited on native mobile, keep the chat on web views / responsive Bubble pages that load the script.
