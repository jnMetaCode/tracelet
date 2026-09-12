// Side-effect entry: `import '@jnmetacode/tracelet/ai-sdk/register'` and every
// AI SDK call in the process streams to tracelet. Configure with env vars:
//   TRACELET_URL       (default http://localhost:4318/v1/traces)
//   OTEL_SERVICE_NAME  (default ai-sdk)
import { register } from './ai-sdk.js';

register();
