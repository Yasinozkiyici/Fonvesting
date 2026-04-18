export type PipelineLogLevel = "info" | "warn" | "error";

export type PipelineLogEvent = {
  ts: string;
  level: PipelineLogLevel;
  phase: string;
  step: string;
  message: string;
  data?: Record<string, unknown>;
};

export function pipelineLog(event: Omit<PipelineLogEvent, "ts">): PipelineLogEvent {
  const row: PipelineLogEvent = { ...event, ts: new Date().toISOString() };
  const line = JSON.stringify(row);
  if (event.level === "error") console.error(line);
  else if (event.level === "warn") console.warn(line);
  else console.info(line);
  return row;
}
