import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

export function initTelemetry() {
  if (!endpoint) return;

  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "mongolz-next",
      [ATTR_SERVICE_VERSION]: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
    instrumentations: [new HttpInstrumentation()],
  });

  sdk.start();

  process.on("SIGTERM", () => sdk.shutdown());
}
