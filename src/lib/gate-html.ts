import { triesLeft, type GateState } from "@/lib/gate";

const SHELL_STYLES = `
:root {
  --paper: #efe6d8;
  --card: #fffaf2;
  --ink: #1c1712;
  --muted: #7a7166;
  --ai: #c24a32;
  --accent: #1f3d34;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  min-height: 100%;
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  background:
    radial-gradient(1200px 600px at 12% -10%, rgba(255, 250, 242, 0.9), transparent 55%),
    radial-gradient(900px 500px at 100% 0%, rgba(194, 74, 50, 0.08), transparent 46%),
    radial-gradient(800px 420px at 80% 100%, rgba(47, 122, 86, 0.1), transparent 50%),
    var(--paper);
}
.wrap {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.card {
  width: min(420px, 100%);
  background: var(--card);
  border: 1px solid rgba(28, 23, 18, 0.08);
  border-radius: 28px;
  padding: 32px 28px 28px;
  box-shadow: 0 30px 80px rgba(28, 23, 18, 0.08);
}
.mark {
  width: 40px;
  height: 40px;
  border-radius: 16px;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  box-shadow: 0 10px 24px rgba(31, 61, 52, 0.22);
}
.mark span {
  display: block;
  width: 8px;
  height: 20px;
  border-radius: 2px;
}
.mark .ai { background: var(--ai); }
.mark .paper { background: var(--paper); }
h1 {
  font-family: ui-serif, Georgia, "Times New Roman", serif;
  font-style: italic;
  font-weight: 600;
  font-size: 28px;
  letter-spacing: -0.03em;
  margin: 16px 0 0;
}
.lede { margin: 8px 0 0; color: var(--muted); font-size: 14px; line-height: 1.45; }
form { margin-top: 24px; display: grid; gap: 12px; }
label { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
input {
  width: 100%;
  margin-top: 8px;
  border: 1px solid rgba(28, 23, 18, 0.12);
  background: #fff;
  border-radius: 999px;
  padding: 12px 16px;
  font: inherit;
  color: var(--ink);
  outline: none;
}
input:focus { border-color: rgba(31, 61, 52, 0.45); }
button {
  border: 0;
  border-radius: 999px;
  padding: 12px 18px;
  background: var(--accent);
  color: var(--paper);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 10px 20px rgba(31, 61, 52, 0.2);
}
.error {
  margin: 16px 0 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: #f6d7cf;
  color: #8a2e1e;
  font-size: 14px;
}
.finger {
  font-size: 88px;
  line-height: 1;
  text-align: center;
  filter: grayscale(0.15);
}
.lock h1 { text-align: center; }
.lock .lede { text-align: center; }
`.replaceAll(/\s+/g, " ").trim();

export function loginPageHtml(options: { error?: string; configured: boolean }): string {
	const error = options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : "";
	const form = options.configured
		? `<form method="post" action="/">
<label>Password
<input type="password" name="password" autocomplete="current-password" required autofocus>
</label>
<button type="submit">Enter</button>
</form>`
		: "";
	const lede = options.configured
		? "Private preview. Enter the password to continue."
		: "This app is locked until SITE_PASSWORD is configured as a Cloudflare secret.";
	return page("Telltale", `<div class="mark" aria-hidden="true"><span class="ai"></span><span class="paper"></span></div>
<h1>Telltale</h1>
<p class="lede">${lede}</p>
${error}
${form}`);
}

export function lockoutPageHtml(remainingMs: number): string {
	const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
	const wait = minutes === 1 ? "a minute" : `${minutes} minutes`;
	return page(
		"Out.",
		`<div class="lock">
<p class="finger" role="img" aria-label="Middle finger">🖕</p>
<h1>Out.</h1>
<p class="lede">Three wrong guesses. Come back in ${wait}.</p>
</div>`,
	);
}

export function loginErrorMessage(state: GateState): string {
	const left = triesLeft(state);
	if (left === 1) return "Wrong password. 1 try left.";
	return `Wrong password. ${left} tries left.`;
}

function page(title: string, body: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${SHELL_STYLES}</style>
</head>
<body>
<main class="wrap">
<section class="card">
${body}
</section>
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
