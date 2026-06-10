# Python (OpenTelemetry SDK) → tracelet

Any Python agent — LangChain, CrewAI, OpenAI Agents SDK, or hand-rolled — can
stream into tracelet through the standard OpenTelemetry SDK. tracelet ingests
the exporter's **default protobuf** encoding, so there is nothing special to
configure.

```bash
pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
npx @jnmetacode/tracelet        # ingest on :4318, UI on :4321
```

```python
import time

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

provider = TracerProvider(resource=Resource.create({"service.name": "py-research-agent"}))
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint="http://127.0.0.1:4318/v1/traces")))
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("example")

with tracer.start_as_current_span("agent.run", attributes={
    "openinference.span.kind": "AGENT",
    "input.value": "summarize the latest local-first AI tools",
}):
    with tracer.start_as_current_span("tool.web_search", attributes={
        "openinference.span.kind": "TOOL",
        "tool.name": "web_search",
        "output.value": "3 results",
    }):
        time.sleep(0.05)   # ... actually call the tool
    with tracer.start_as_current_span("llm.generate", attributes={
        "gen_ai.system": "anthropic",
        "gen_ai.request.model": "claude-sonnet-4-6",
        "gen_ai.usage.input_tokens": 812,
        "gen_ai.usage.output_tokens": 240,
        "ai.response.text": "Local-first agent tooling is converging on …",
    }):
        time.sleep(0.1)    # ... actually call the model

provider.shutdown()  # flush before exit — don't lose the last batch
```

Open `http://127.0.0.1:4321`: one `agent.run` trace with a tool span and an LLM
span, model name and **token counts** parsed from the `gen_ai.*` attributes.

Notes:

- If the process is long-running you don't need `shutdown()`; the batch
  processor flushes on its own. For short scripts, always call it.
- Frameworks that already speak OpenTelemetry (LangChain via
  `opentelemetry-instrumentation`, OpenAI Agents SDK tracing processors, …)
  only need the endpoint env var:

  ```bash
  export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
  ```

- tracelet recognizes both the OpenTelemetry **GenAI** semantic conventions
  (`gen_ai.*`) and **OpenInference** (`openinference.span.kind`, `input.value`,
  `output.value`), plus the Vercel AI SDK's `ai.*` attributes.
