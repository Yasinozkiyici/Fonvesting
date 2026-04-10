type AlertSeverity = "info" | "warning" | "error";

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`alert_http_${response.status}`);
  }
}

async function sendWebhookAlert(text: string): Promise<void> {
  const url =
    env("OPS_ALERT_WEBHOOK_URL") ??
    env("SLACK_WEBHOOK_URL");
  if (!url) return;

  await postJson(url, { text });
}

async function sendTelegramAlert(text: string): Promise<void> {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chatId = env("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return;

  await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

export async function sendOpsAlert(input: {
  title: string;
  severity?: AlertSeverity;
  lines?: Array<string | null | undefined>;
}): Promise<void> {
  const severity = input.severity ?? "warning";
  const prefix =
    severity === "error" ? "CRON ERROR" : severity === "warning" ? "CRON WARNING" : "CRON INFO";
  const lines = [input.title, ...(input.lines ?? []).filter((line): line is string => Boolean(line && line.trim()))];
  const text = [`[${prefix}] fonvesting`, ...lines].join("\n");

  const results = await Promise.allSettled([sendWebhookAlert(text), sendTelegramAlert(text)]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[ops-alert] send failed", result.reason);
    }
  }
}
