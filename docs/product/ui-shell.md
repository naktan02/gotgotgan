# UI shell

The Place shell owns its top bar, product navigation, responsive side panel, and screen composition.
Place feature pages appear above a separator; family destinations appear below it from an injected
`family-navigation.v1` manifest.

The global family manifest composer has no selected owner. Stage 1 therefore renders an explicit
`not-integrated` fixture with no hard-coded service destinations. Public shared maps may later use a
reduced shell that does not expose authenticated controls.
