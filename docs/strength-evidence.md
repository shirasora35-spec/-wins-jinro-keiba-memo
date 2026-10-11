# Strength evidence draft (not published)

Status: source-independent implementation only. No approved data feed, production dataset, or calibrated thresholds is supplied. Keep `STRENGTH_PUBLICATION_ENABLED` unset. `/strength` then returns 404 before reading data. There is deliberately no link from the existing memo page. This draft is not a usable public service yet.

## Scope

Three independent observations per race/horse, no composite score or horse ranking:

1. **Clock:** compare horse elapsed seconds with the historical median **winner** clock for exactly matching venue, course configuration, surface, distance, going, and class. Baseline must predate the race and exclude its ID. Same-day correction is the median of other winning-clock-minus-own-class-baseline residuals, with the same course, surface, distance, and going. The evaluated race is excluded. A positive correction denotes slower conditions. Corrected advantage = baseline − horse time + correction. Report comparison IDs, count, residual range, and baseline sample count. Without enough comparison races (explicit import setting, at least two), return reference; do not silently use zero. Unvalidated criteria or excessively dispersed comparisons also remain reference. Exact matching is conservative: many meetings will remain unassessed/reference until a validated broader model exists.
2. **Sustained pace:** requires an independently validated condition-specific consecutive-section profile and complete expected passage ranks. Every selected section must meet its 200m-normalized threshold; every available expected passage must be within the calibrated rank. Winning is unnecessary. This identifies a fast-pace race plus forward positions, **not** proven individual exertion. Ranks omit distance gaps; leader sectionals may describe different horses. Partial initial furlongs are represented with actual meters and normalized, not assumed to be 200m.
3. **Accelerating finish:** a descriptive observation only: last three sections must each be 200m and strictly successively quicker, and this horse must have won (dead-heat winners qualify). Missing laps/finish remain unassessed. This does not establish the winner's individual acceleration or a predictive edge. Other acceleration definitions require an explicit method change.

States: `supported` (specified observation verified), `reference` (numbers exist but comparison/calibration insufficient), `unassessed` (missing inputs), `not-observed` (specified condition not met). None means weak. No default course thresholds or confidence percentages exist.

## Data boundary and publication prerequisites

`lib/strength-import.ts` accepts unknown JSON and validates an `ApprovedStrengthInput`; `prepareStrengthReport` returns only whitelisted public fields. Input path: private Blob/local `keiba-cache/strength/approved-input.json`. Runtime import is separately lazy-loaded through `/strength` and cached server-side for 60 seconds. Existing memo data, refresh jobs, external request count, and home bundles are unchanged. There is no provider adapter that fetches history and no new upload/API endpoint.

An operator must first obtain and document permission covering the specific source, retained inputs, automatic analysis, displayed derived outputs, audience, and update frequency. `source.publicationApproved: true` and `source.approvalReference` record that human decision; they cannot establish a license by themselves. `source.synthetic` must be false. Source labels/URLs must identify the actual approved provider. Do not set these fields merely to bypass the gate. Synthetic tests use deliberately fabricated fixtures, never a deployable data file.

Before enabling:

- Resolve provider rights; existing netkeiba availability and personal JRA-VAN access are not blanket redistribution authorization.
- Build an approved source-specific adapter and authenticated ingestion workflow, retaining retrieval time, source digest/version where available, and private provenance.
- Validate baseline statistic, sample period, sample sizes, comparable conditions, and source corrections. Current schema accepts one baseline/calibration per exact condition; split time-varying versions into separate reports rather than silently choosing between duplicates.
- Independently review each calibration, record `evidence`, `clockAdvantageSeconds`, `maxCorrectionSpreadSeconds`, and the pace profile. No production values are provided. Sample sufficiency and correction dispersion limits are reliability policies, not statistical confidence.
- Test those actual adapters/datasets, review displayed evidence on mobile, and get approval to publish. Add navigation only when usable approved data exists.

Historical corrected datasets are not automatically point-in-time datasets. Race date filtering prevents obvious baseline leakage but does not prove what was known at historical prediction time. This is a descriptive past-race view, not a validated backtest.

## Verification

`npm test`, `npx tsc --noEmit`, `npm run build`. Test fixtures cover self-exclusion, wrong conditions, missing/sparse inputs, unvalidated thresholds, all required passages, no winner requirement for pace, winner requirement for acceleration, partial sectionals, source gate, invalid payloads, duplicate IDs, and public metadata minimization. No real provider was ingested or queried by these tests.
