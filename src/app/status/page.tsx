import { DiagnosticsView } from "@/components/DiagnosticsView";

export const dynamic = "force-dynamic";

/** /diagnostics bazı ortamlarda engellenirse /status deneyin */
export default function StatusPage() {
  return <DiagnosticsView title="Yatirim.io — durum (/status)" />;
}
