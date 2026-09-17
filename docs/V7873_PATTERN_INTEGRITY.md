# V7.8.7.3 Pattern Integrity

Capa Shadow exclusivamente de auditoría. No modifica Core V7.0, pesos, gates, ranking ni picks.

## Correcciones
- PUSH es estado terminal para Pattern Auditor.
- Candidatos dejan de ser "pregame" al iniciar el partido, incluso si Censo tarda en liquidar.
- Liquidación puede tomar el FINAL ya visible en la jornada live sin esperar a que Censo copie el estado.
- FIRST MATCH y CLOSE MATCH quedan separados; el W-L-P usa exclusivamente CLOSE.
- Si un candidato deja de cumplir antes del inicio, queda auditado pero no cuenta en el récord del patrón.
- Null/undefined ya no se convierten silenciosamente a cero.
- Ledger migra V7.8.7.2 y se espeja dentro del Censo, entrando al snapshot SQLite/Data Vault/Rolling Backup.
- Badges de Jornada prefieren gamePk y mejoran doubleheaders.
- Refresco Pattern baja de 1.8 s a 10 s y sólo persiste cuando cambian datos relevantes.

## Reglas congeladas
A: OVER, P>=58%, edge>=8.5%, dispersion >14% y <=16%, 4/4 >50%, min>=53%, RAW>P, estabilidad estricta.
A2: igual, dispersion 8-12%.
B: OVER + 4/4 >50% + RAW>P + estabilidad estricta. B incluye A/A2.
C: OVER P>=50% con RAW<50% o al menos un motor <=50%.

Baseline histórico congelado: A 4-0; A2 1-0 (SEA-LAA).
