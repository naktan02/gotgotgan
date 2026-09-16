# Media module

Media owns stable Place media source identities and append-only display-rights decisions. A Provider
photo URL is not an owned asset and is never used as the source identity: Provider media uses an
opaque Provider media identifier tied to a Source Observation, while first-party assets use an
opaque object reference. Both retain the exact normalized media assertion that justified creating
the stable media identity; a source without assertion provenance is rejected.

`PlaceMediaCatalog` records a source, advances one rights revision, and lists only sources whose
current decision allows the requested surface and time. Places may select media for an immutable
Canonical Place Profile revision, but selection never grants rights. A delivery Adapter may later
turn the opaque source locator into a short-lived URI; browser contracts never receive Provider
identities, object keys, capture references, or credentials from this Module.
