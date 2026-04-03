import { createLogger } from "@/lib/logger";

const log = createLogger("OpsMetrics");

type MetricValue = string | number | boolean | null | undefined;

export function recordMetric(name: string, fields: Record<string, MetricValue>): void {
  const payload = {
    metric: name,
    ts: new Date().toISOString(),
    ...fields,
  };
  log.log(JSON.stringify(payload));
}

