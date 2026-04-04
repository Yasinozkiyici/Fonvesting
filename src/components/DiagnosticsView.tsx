import { getDiagnosticsSnapshot } from "@/lib/diagnostics-snapshot";

export async function DiagnosticsView({ title }: { title?: string }) {
  const { fundCount, err, dbUrlPreview, effectiveDbUrlPreview } = await getDiagnosticsSnapshot();

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: 24,
        maxWidth: 640,
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: 22, color: "var(--text-primary, #111)" }}>
        {title ?? "Yatirim.io — teşhis"}
      </h1>
      <p style={{ color: "var(--text-secondary, #444)" }}>
        Sunucuda render; istemci JS şart değil. Bu projede <code>service</code> adı <strong>fonvesting</strong> olmalı;
        yanıtta <code>bistmarketcap</code> görüyorsanız <strong>eski deploy</strong> veya yanlış site açıktır.
      </p>
      <ul style={{ color: "var(--text-primary, #111)" }}>
        <li>
          <code>Fund</code> kayıt sayısı: <strong>{err ? "—" : fundCount}</strong>
        </li>
        <li>
          <code>DATABASE_URL</code> (.env’deki özet):{" "}
          <code style={{ wordBreak: "break-all", fontSize: 13 }}>{dbUrlPreview}</code>
        </li>
        <li>
          Prisma’ya giden (mutlak SQLite):{" "}
          <code style={{ wordBreak: "break-all", fontSize: 13 }}>{effectiveDbUrlPreview}</code>
        </li>
        {err && (
          <li style={{ color: "crimson" }}>
            Prisma: <code>{err}</code>
          </li>
        )}
      </ul>
      <p style={{ color: "var(--text-secondary, #444)" }}>
        <a href="/api">/api</a> (liste) · <a href="/api/health">/api/health</a> ·{" "}
        <a href="/api/funds?pageSize=2">/api/funds</a>
      </p>
    </div>
  );
}
