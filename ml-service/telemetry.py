"""OpenTelemetry setup for MONGOLZ ML service."""

from __future__ import annotations

import logging
import os

log = logging.getLogger("mongolz-ml.telemetry")


def init_telemetry(app):
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if not endpoint:
        log.info("OTEL_EXPORTER_OTLP_ENDPOINT not set — telemetry disabled")
        return

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        resource = Resource.create({
            "service.name": "mongolz-ml",
            "service.version": "1.0.0",
        })

        provider = TracerProvider(resource=resource)
        exporter = OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces")
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)

        FastAPIInstrumentor.instrument_app(app)
        log.info("OpenTelemetry initialized — exporting to %s", endpoint)

    except ImportError as e:
        log.warning("OpenTelemetry packages not available: %s", e)
    except Exception as e:
        log.error("Failed to initialize OpenTelemetry: %s", e)
