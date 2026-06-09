// Zero-dependency decoder for OTLP/HTTP protobuf (the default many OTel exporters
// send). It decodes ExportTraceServiceRequest into the SAME object shape as the
// OTLP/JSON form, so the existing parseOtlp() handles everything downstream.
//
// Field numbers are from the official opentelemetry-proto (trace/v1, common/v1),
// so this matches what real exporters emit on the wire.

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LEN = 2;
const WIRE_FIXED32 = 5;

class Reader {
  constructor(buf) {
    this.b = buf;
    this.p = 0;
    this.len = buf.length;
  }
  eof() {
    return this.p >= this.len;
  }
  varint() {
    let shift = 0n;
    let result = 0n;
    let byte;
    do {
      byte = this.b[this.p++];
      result |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
    } while (byte & 0x80);
    return result;
  }
  key() {
    const k = Number(this.varint());
    return { field: k >>> 3, wire: k & 7 };
  }
  bytes() {
    const n = Number(this.varint());
    const s = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return s;
  }
  fixed64() {
    const s = this.b.subarray(this.p, this.p + 8);
    this.p += 8;
    return s;
  }
  skip(wire) {
    if (wire === WIRE_VARINT) this.varint();
    else if (wire === WIRE_LEN) this.bytes();
    else if (wire === WIRE_FIXED64) this.p += 8;
    else if (wire === WIRE_FIXED32) this.p += 4;
    else throw new Error(`unsupported wire type ${wire}`);
  }
}

const u64le = (b) => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[i] || 0);
  return v;
};
const f64le = (b) => new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true);
const str = (b) => Buffer.from(b).toString('utf8');
const hex = (b) => Buffer.from(b).toString('hex');

// common.v1 AnyValue -> the OTLP/JSON {stringValue|intValue|...} wrapper.
function anyValue(buf) {
  const r = new Reader(buf);
  const out = {};
  while (!r.eof()) {
    const { field, wire } = r.key();
    switch (field) {
      case 1: out.stringValue = str(r.bytes()); break;
      case 2: out.boolValue = r.varint() !== 0n; break;
      case 3: out.intValue = r.varint().toString(); break; // int64 as string (JSON convention)
      case 4: out.doubleValue = f64le(r.fixed64()); break;
      case 5: out.arrayValue = arrayValue(r.bytes()); break;
      case 6: out.kvlistValue = { values: keyValues(r.bytes()) }; break;
      case 7: out.bytesValue = hex(r.bytes()); break;
      default: r.skip(wire);
    }
  }
  return out;
}

function arrayValue(buf) {
  const r = new Reader(buf);
  const values = [];
  while (!r.eof()) {
    const { field, wire } = r.key();
    if (field === 1 && wire === WIRE_LEN) values.push(anyValue(r.bytes()));
    else r.skip(wire);
  }
  return { values };
}

function keyValue(buf) {
  const r = new Reader(buf);
  const kv = {};
  while (!r.eof()) {
    const { field, wire } = r.key();
    if (field === 1) kv.key = str(r.bytes());
    else if (field === 2) kv.value = anyValue(r.bytes());
    else r.skip(wire);
  }
  return kv;
}

// Decode a buffer that is a sequence of repeated KeyValue submessages (used by
// kvlist values, resource attributes, span attributes, event attributes).
function keyValues(buf) {
  const r = new Reader(buf);
  const out = [];
  while (!r.eof()) {
    const { field, wire } = r.key();
    if (field === 1 && wire === WIRE_LEN) out.push(keyValue(r.bytes()));
    else r.skip(wire);
  }
  return out;
}

function collect(buf, fieldNo, fn) {
  const r = new Reader(buf);
  const out = [];
  while (!r.eof()) {
    const { field, wire } = r.key();
    if (field === fieldNo && wire === WIRE_LEN) out.push(fn(r.bytes()));
    else r.skip(wire);
  }
  return out;
}

function event(buf) {
  const r = new Reader(buf);
  const e = { attributes: [] };
  while (!r.eof()) {
    const { field, wire } = r.key();
    if (field === 1) e.timeUnixNano = u64le(r.fixed64()).toString();
    else if (field === 2) e.name = str(r.bytes());
    else if (field === 3) e.attributes.push(keyValue(r.bytes()));
    else r.skip(wire);
  }
  return e;
}

function status(buf) {
  const r = new Reader(buf);
  const s = {};
  while (!r.eof()) {
    const { field, wire } = r.key();
    if (field === 2) s.message = str(r.bytes());
    else if (field === 3) s.code = Number(r.varint());
    else r.skip(wire);
  }
  return s;
}

function span(buf) {
  const r = new Reader(buf);
  const sp = { attributes: [], events: [] };
  while (!r.eof()) {
    const { field, wire } = r.key();
    switch (field) {
      case 1: sp.traceId = hex(r.bytes()); break;
      case 2: sp.spanId = hex(r.bytes()); break;
      case 4: sp.parentSpanId = hex(r.bytes()); break;
      case 5: sp.name = str(r.bytes()); break;
      case 6: sp.kind = Number(r.varint()); break;
      case 7: sp.startTimeUnixNano = u64le(r.fixed64()).toString(); break;
      case 8: sp.endTimeUnixNano = u64le(r.fixed64()).toString(); break;
      case 9: sp.attributes.push(keyValue(r.bytes())); break;
      case 11: sp.events.push(event(r.bytes())); break;
      case 15: sp.status = status(r.bytes()); break;
      default: r.skip(wire);
    }
  }
  return sp;
}

function scope(buf) {
  const r = new Reader(buf);
  const s = {};
  while (!r.eof()) {
    const { field, wire } = r.key();
    if (field === 1) s.name = str(r.bytes());
    else if (field === 2) s.version = str(r.bytes());
    else r.skip(wire);
  }
  return s;
}

function resource(buf) {
  return { attributes: collect(buf, 1, keyValue) };
}

function scopeSpans(buf) {
  const r = new Reader(buf);
  const ss = { spans: [] };
  while (!r.eof()) {
    const { field, wire } = r.key();
    if (field === 1) ss.scope = scope(r.bytes());
    else if (field === 2) ss.spans.push(span(r.bytes()));
    else r.skip(wire);
  }
  return ss;
}

function resourceSpans(buf) {
  const r = new Reader(buf);
  const rs = { scopeSpans: [] };
  while (!r.eof()) {
    const { field, wire } = r.key();
    if (field === 1) rs.resource = resource(r.bytes());
    else if (field === 2) rs.scopeSpans.push(scopeSpans(r.bytes()));
    else r.skip(wire);
  }
  return rs;
}

/**
 * Decode an OTLP/HTTP protobuf ExportTraceServiceRequest into the same JSON
 * object shape parseOtlp() consumes: { resourceSpans: [...] }.
 */
export function decodeTraces(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return { resourceSpans: collect(buf, 1, resourceSpans) };
}
