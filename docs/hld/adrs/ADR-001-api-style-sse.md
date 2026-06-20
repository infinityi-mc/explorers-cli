# ADR-001: Use REST and Server-Sent Events for LLM Integration

- **Status**: Proposed
- **Date**: 2026-06-19
- **Deciders**: Principal Technical Lead
- **Tags**: api, infrastructure, performance

## Context

The application is a single-process terminal tool running on Bun. It acts as an orchestrator, routing player/operator questions to Large Language Models (LLM) and delivering responses.
To support real-time token rendering in the TUI chat console (FR-INV-002), we need a communication mechanism that handles stream delivery.
The host has strict memory guidelines: keeping RSS below 200 MB at idle and below 500 MB under load (NFR-PERF-003). Holding a complete multi-paragraph model output in Node heap memory before rendering is inefficient and can cause memory spikes.

## Requirements driving this decision

List the FRs and NFRs that this decision addresses:

- `FR-INV-002` — Streaming agent response tokens to the TUI panel in real-time.
- `NFR-PERF-003` — Process RSS memory footprint bounds (200-500 MB).
- `FR-INV-003` — Aborting or canceling requests on timeouts.
- `NFR-SEC-007` — Preventing credential leakage in process channels.

## Options considered

### Option 1: Standard Synchronous HTTPS REST (JSON Block Output)

Wait for the complete response block to generate on the provider's server, then return the text packet in a single JSON body.

- **Pros**:
  - Simple, synchronous control loop.
  - Easier JSON string parsing.
- **Cons**:
  - Visual lag in TUI; operator must wait for the entire generation before seeing characters (violates FR-INV-002).
  - Forces buffering of long strings in memory, increasing RSS heap pressure under concurrent player triggers (violates NFR-PERF-003).
- **Satisfies**: `NFR-SEC-007`
- **Tensions**: `FR-INV-002`, `NFR-PERF-003`

### Option 2: HTTPS REST + Server-Sent Events (SSE) (Streaming Tokens)

Initiate outbound requests with `stream: true` configurations. Parse incoming text chunks incrementally via Server-Sent Events protocols.

- **Pros**:
  - Matches LLM providers' native streaming formats (OpenAI, Anthropic, and compatible routers).
  - Direct rendering in the TUI window as soon as tokens arrive (satisfies FR-INV-002).
  - Memory efficient; keeps heap allocation minimal since characters are processed and painted to the viewport immediately (satisfies NFR-PERF-003).
- **Cons**:
  - Increases stream decoding logic complexity.
  - Interrupted connections require handling partial text outputs.
- **Satisfies**: `FR-INV-002`, `NFR-PERF-003`, `FR-INV-003`
- **Tensions**: None.

---

## Decision

We will use HTTPS REST and Server-Sent Events (SSE) streaming for all external LLM provider communications.

---

## Rationale

Option 2 satisfies `FR-INV-002` by enabling token-by-token rendering in the TUI dashboard chat panel. Streaming keeps heap memory usage constant rather than proportional to the generated response length, satisfying `NFR-PERF-003`.
Outbound HTTPS connections are built using native Bun/Node fetch clients, allowing us to abort the stream directly using `AbortController` signals when agent timeouts are reached (FR-INV-003).

---

## Consequences

**Positive**:

- Operator sees typing-style real-time agent output.
- Reduces Bun heap memory usage since long responses are not buffered before display.

**Negative**:

- Stream decoding and partial chunk assembling add runtime event complexity.
- Handling JSON formatting checks is more complex on partial data.

**Neutral**:

- The system is dependent on LLM providers maintaining support for stable SSE streaming.

---

## Mitigations for negative consequences

- **Partial Chunk Parsing** → Use standard SSE message parsers (like the adapters in `@infinityi/engine-lib/providers`) to validate chunk envelopes before drawing.
- **Stream Interruption** → If a stream drops mid-generation, log the event, flush the partial response database record, and display a connection error in the TUI chat without crashing the manager.

---

## Links

- Related ADRs: None
- SRS sections: Section 3.7 (LLM Provider Interface), Section 4.7 (Agent Invocation)
- External references: [MDN Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
