import { getSystemHealthSnapshot } from "@/lib/system-health";

export async function DiagnosticsView({ title }: { title?: string }) {
  const snapshot = await getSystemHealthSnapshot({ includeExternalProbes: true });

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
        {title ?? "Fonvesting — teşhis"}
      </h1>
      <p style={{ color: "var(--text-secondary, #444)" }}>
        Sunucuda render; istemci JS şart değil. Bu projede <code>service</code> adı <strong>fonvesting</strong> olmalı.
        Farklı bir servis adı görüyorsanız yanlış deploy açık olabilir.
      </p>
      <p style={{ color: "var(--text-secondary, #444)" }}>
        Durum: <strong>{snapshot.status}</strong> · kontrol zamanı:{" "}
        <code style={{ fontSize: 13 }}>{snapshot.checkedAt}</code>
      </p>
      <ul style={{ color: "var(--text-primary, #111)" }}>
        <li>
          <code>Fund</code> kayıt sayısı: <strong>{snapshot.counts.funds}</strong>
        </li>
        <li>
          Aktif fon: <strong>{snapshot.counts.activeFunds}</strong>
        </li>
        <li>
          Son günlük snapshot:{" "}
          <code style={{ wordBreak: "break-all", fontSize: 13 }}>
            {snapshot.freshness.latestFundSnapshotDate ?? "yok"}
          </code>
        </li>
        <li>
          Snapshot kapsamı açığı: <strong>{snapshot.integrity.latestSnapshotCoverageGap ?? 0}</strong>
        </li>
        <li>
          <code>DATABASE_URL</code> özeti:{" "}
          <code style={{ wordBreak: "break-all", fontSize: 13 }}>{snapshot.database.dbUrlPreview}</code>
        </li>
        <li>
          Prisma bağlantısı:{" "}
          <code style={{ wordBreak: "break-all", fontSize: 13 }}>{snapshot.database.effectiveDbUrlPreview}</code>
        </li>
        <li>
          Son source refresh: <strong>{snapshot.jobs.sourceRefresh?.status ?? "yok"}</strong>{" "}
          <code style={{ fontSize: 13 }}>{snapshot.jobs.sourceRefresh?.completedAt ?? snapshot.jobs.sourceRefresh?.startedAt ?? "-"}</code>
        </li>
        <li>
          Son serving rebuild: <strong>{snapshot.jobs.servingRebuild?.status ?? "yok"}</strong>{" "}
          <code style={{ fontSize: 13 }}>{snapshot.jobs.servingRebuild?.completedAt ?? snapshot.jobs.servingRebuild?.startedAt ?? "-"}</code>
        </li>
        <li>
          Son warm scores: <strong>{snapshot.jobs.warmScores?.status ?? "yok"}</strong>{" "}
          <code style={{ fontSize: 13 }}>{snapshot.jobs.warmScores?.completedAt ?? snapshot.jobs.warmScores?.startedAt ?? "-"}</code>
        </li>
      </ul>
      {snapshot.issues.length > 0 ? (
        <>
          <h2 style={{ fontSize: 18, marginTop: 24, color: "var(--text-primary, #111)" }}>Tespit edilen sorunlar</h2>
          <ul style={{ color: "var(--text-primary, #111)" }}>
            {snapshot.issues.map((issue) => (
              <li key={issue.code} style={{ color: issue.severity === "error" ? "crimson" : "inherit" }}>
                <code>{issue.code}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {snapshot.errors.length > 0 ? (
        <>
          <h2 style={{ fontSize: 18, marginTop: 24, color: "var(--text-primary, #111)" }}>Sorgu hataları</h2>
          <ul style={{ color: "crimson" }}>
            {snapshot.errors.map((error) => (
              <li key={error}>
                <code>{error}</code>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p style={{ color: "var(--text-secondary, #444)" }}>
        <a href="/api">/api</a> (liste) · <a href="/api/health">/api/health</a> ·{" "}
        <a href="/api/funds?pageSize=2">/api/funds</a>
      </p>
    </div>
  );
}
