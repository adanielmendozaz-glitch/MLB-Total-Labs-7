# Calibration Shadow V1.2.1 — Hotfix de etiquetas

Base exacta:
`v786-calibration-shadow-v1`
commit `e34a6d404f7f36568c92c2e5b9426a03f70fac84`

## Bug encontrado

En scorecards EN VIVO no siempre existen `.sc-analysis` o `.sc-schedule`.
V1.2 usaba el propio `.game.scorecard` como fallback y luego hacía
`insertAdjacentElement('afterend', badge)`.

Eso colocaba la etiqueta **fuera** de la tarjeta. En el siguiente refresco
la tarjeta ya no encontraba esa etiqueta dentro de sí y creaba otra.
El intervalo/observer repetía el proceso y aparecían decenas de
`ESTABLE` / `PROMOVIDO` sueltos.

## Corrección

- La etiqueta nunca vuelve a salir del scorecard.
- Para juegos en vivo usa `.sc-live-row`, `.sc-pitchers` o `.sc-teams`.
- Si no existe un sub-contenedor seguro, se hace `appendChild` dentro de la tarjeta.
- Se eliminan automáticamente badges huérfanos creados por V1.2.
- Las actualizaciones de badge son idempotentes.
- Se elimina el MutationObserver global y se conserva refresco por intervalo/eventos.
- No cambia motores, probabilidades, filtros, picks, Censo, Team Shadow ni DataVault.

La firma Android estable introducida en V1.2 se conserva.
Por lo tanto V1.2.1 debe instalarse como **actualización normal** sobre V1.2.
