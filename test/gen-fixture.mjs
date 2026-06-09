// Regenerate the golden OTLP/protobuf fixture used in test/run.js.
//
//   cd /tmp && mkdir g && cd g && npm i protobufjs long
//   node /path/to/tracelet/test/gen-fixture.mjs   # prints base64; paste into run.js
//
// Kept out of package.json deps on purpose — tracelet ships zero dependencies;
// this is a dev-only reproducibility tool. Field numbers below are the authentic
// opentelemetry-proto numbers, so the bytes match what real exporters emit.

import protobuf from 'protobufjs';
import Long from 'long';
protobuf.util.Long = Long;
protobuf.configure();

// Minimal OTLP proto with the AUTHENTIC field numbers from opentelemetry-proto.
const proto = `
syntax = "proto3";
package otlptest;
message ExportTraceServiceRequest { repeated ResourceSpans resource_spans = 1; }
message ResourceSpans { Resource resource = 1; repeated ScopeSpans scope_spans = 2; string schema_url = 3; }
message Resource { repeated KeyValue attributes = 1; }
message ScopeSpans { InstrumentationScope scope = 1; repeated Span spans = 2; string schema_url = 3; }
message InstrumentationScope { string name = 1; string version = 2; }
message Span {
  bytes trace_id = 1; bytes span_id = 2; string trace_state = 3; bytes parent_span_id = 4;
  string name = 5; uint32 kind = 6; fixed64 start_time_unix_nano = 7; fixed64 end_time_unix_nano = 8;
  repeated KeyValue attributes = 9; uint32 dropped_attributes_count = 10; repeated Event events = 11;
  Status status = 15;
}
message Event { fixed64 time_unix_nano = 1; string name = 2; repeated KeyValue attributes = 3; }
message Status { string message = 2; uint32 code = 3; }
message KeyValue { string key = 1; AnyValue value = 2; }
message AnyValue {
  oneof value { string string_value = 1; bool bool_value = 2; int64 int_value = 3;
    double double_value = 4; ArrayValue array_value = 5; KeyValueList kvlist_value = 6; bytes bytes_value = 7; }
}
message ArrayValue { repeated AnyValue values = 1; }
message KeyValueList { repeated KeyValue values = 1; }
`;

const root = protobuf.parse(proto, { keepCase: true }).root;
const Req = root.lookupType('otlptest.ExportTraceServiceRequest');

const sv = (s) => ({ string_value: s });
const iv = (n) => ({ int_value: Long.fromString(String(n)) });
const ts = (s) => Long.fromString(s, true);

const payload = {
  resource_spans: [
    {
      resource: { attributes: [{ key: 'service.name', value: sv('weather-agent') }] },
      scope_spans: [
        {
          scope: { name: 'demo', version: '1.0.0' },
          spans: [
            {
              trace_id: Buffer.from('5b8efff798038103d269b633813fc60c', 'hex'),
              span_id: Buffer.from('eee19b7ec3c1b174', 'hex'),
              parent_span_id: Buffer.alloc(0),
              name: 'ai.generateText',
              kind: 1,
              start_time_unix_nano: ts("1718000000000000000"),
              end_time_unix_nano: ts("1718000001200000000"),
              status: { code: 1 },
              attributes: [
                { key: 'gen_ai.system', value: sv('anthropic') },
                { key: 'gen_ai.request.model', value: sv('claude-sonnet-4.5') },
                { key: 'gen_ai.usage.input_tokens', value: iv(42) },
                { key: 'gen_ai.usage.output_tokens', value: iv(128) },
                { key: 'ai.prompt', value: sv('hello there') },
                { key: 'ai.response.text', value: sv('hi!') },
              ],
              events: [
                {
                  time_unix_nano: ts("1718000000500000000"),
                  name: 'gen_ai.content.prompt',
                  attributes: [{ key: 'gen_ai.prompt', value: sv('hello there') }],
                },
              ],
            },
            {
              trace_id: Buffer.from('5b8efff798038103d269b633813fc60c', 'hex'),
              span_id: Buffer.from('aaa1234567890bcd', 'hex'),
              parent_span_id: Buffer.from('eee19b7ec3c1b174', 'hex'),
              name: 'ai.toolCall',
              kind: 1,
              start_time_unix_nano: ts("1718000000600000000"),
              end_time_unix_nano: ts("1718000000900000000"),
              status: { code: 2, message: 'boom' },
              attributes: [
                { key: 'tool.name', value: sv('get_weather') },
                { key: 'ai.toolCall.args', value: sv('{"city":"SF"}') },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const err = Req.verify(payload);
if (err) throw new Error(err);
const buf = Req.encode(Req.fromObject(payload)).finish();
console.log(Buffer.from(buf).toString('base64'));
