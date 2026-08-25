# 0001: TypeScript web, server, and acquisition worker

Status: accepted

Date: 2026-08-25

## Context

Place is dominated by web contracts, provider HTTP, Crawlee queues, Playwright sessions, and durable
job orchestration. A Python server would add a second runtime before ML or offline analysis exists.

## Decision

Use Next.js/React/TypeScript for web and Node.js/TypeScript/Fastify for the backend. Build the
always-on HTTP server and on-demand-capable acquisition worker as separate process entrypoints from
one backend package. Use Crawlee/Playwright inside provider adapters only when required.

## Consequences

Web, HTTP, worker, contracts, and browser automation share one language and lockfile. The worker can
scale independently without duplicating domain implementation. Python may appear later behind a
versioned AI/analysis interface for recommendation, embeddings, or offline data science.

## Supersession condition

Revisit only with measured runtime constraints or an implemented analytical capability whose
Python-local data path provides more value than the additional process and contract cost.
