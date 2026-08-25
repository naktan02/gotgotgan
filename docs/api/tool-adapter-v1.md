# Tool Adapter v1

AI Tools are transports owned by the module whose use case they expose. Read tools require explicit
scope; write tools additionally require preview, approval, idempotency, audit, and reauthorization.
The AI Orchestrator receives schemas and results, never a Place database connection.
