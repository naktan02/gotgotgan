# Dependency rules

Backend domain code imports neither application, adapter, transport, platform, nor entrypoint code.
Application code owns external ports. Adapters satisfy ports. Transports invoke module interfaces.
Modules never import process entrypoints or another repository's source.

Frontend direction is `app -> shells/features/domains/platform/shared`, with each layer importing only
the layers to its right. Repository checks reject global frontend dumping grounds and backend
`controllers`, `services`, or `repositories` buckets.

Platform owners also declare cross-owner direction explicitly. The membership browser boundary may
consume the auth session interface; auth cannot import membership, and undeclared platform-sibling
imports fail architecture validation. This keeps process composition from creating a reverse
business dependency.
