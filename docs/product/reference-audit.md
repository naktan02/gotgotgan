# Reference audit

The accepted structural references and rejected prototype traits are recorded in
`../../../plans/place-platform-ui-design-brief.md`. Use that source for provenance and links.

Retain a calm product shell, map/list coordination, personal metadata distinct from provider data,
and responsive navigation. Reject generic rounded-card grids, decorative gradients, emoji icons,
fake imagery, and equal visual weight for every action.

## 2026-08-29 map-product audit

Google Maps and NAVER Map were inspected with Playwright at `1440x900` and `390x844`. The audit used
public place search/list/detail screens only; screenshots remain local research evidence and are not
copied into the product or repository.

- Google Maps desktop keeps a compact product rail, a bounded search-result list, an independent
  selected-place panel, and the map visible together. Closing detail preserves the query and list.
- NAVER Map desktop follows the same pane sequence with denser filters, review snippets, explicit
  save affordances, photo strips, and sticky detail tabs.
- Google Maps mobile and NAVER's dedicated mobile Map/Place surfaces use one primary surface at a
  time. Search results become a full-width list; selecting a result opens a full-width detail and
  back navigation restores the list context.
- NAVER's desktop route clipped rather than reflowing when forced to a phone viewport. The dedicated
  mobile routes were therefore inspected separately; desktop clipping is explicitly rejected.

Stage 7.14 retains the shared behavior, not either product's brand or provider-specific actions:
desktop Library uses coordinated list, selected detail, and map panes; mobile uses explicit list/map
switching and a separate detail surface with focus returned to the selected row. Place keeps its own
saved/wanted/Personal Rating, Collection/Tag, Visit, and private Note controls. Advertising,
reservation/commerce density, provider-owned reviews, and fake imagery are not carried over.
