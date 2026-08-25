# Module boundaries

Backend business capabilities live at `backend/src/modules/<module>`. Each module may contain
`domain`, `application`, `adapters`, `transport`, and `tests`; it creates only leaves it uses.

The module interface is the caller and test surface. Domain rules remain framework-free.
Persistence stays at `<module>/adapters/persistence`, not a global repository bucket. Provider-specific
HTTP, structured-web, browser, parser, and outbound-sync adapters stay under the providers module.

Entrypoints compose modules and own processes. They do not decide canonical identity, authorization,
retry policy, or merge outcomes.
