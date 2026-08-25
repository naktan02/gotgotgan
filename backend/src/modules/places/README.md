# Places module

Places owns provider-independent Canonical Place identity, provider identity links, redirects,
retirement, and merge/split lineage. Its small public interface applies one typed canonical
resolution command and resolves either a Canonical Place reference or a provider identity.

Supported mutations are create, link provider identity, merge, split one provider identity, and
retire. Every attempt carries an immutable decision identity, source-decision reference, policy
version, occurrence time, and fingerprint. An identical retry is a replay; the same decision ID with
different content is a conflict.

The module does not parse provider payloads or decide whether evidence is sufficient. Ingestion owns
those decisions. Composition translates the accepted decision without either business module
importing the other's source.
