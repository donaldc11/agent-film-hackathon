/* @bruin
name: film.endings
type: duckdb.sql
description: How endings compare across runs.
materialization:
  type: table
depends:
  - film.raw_runs
@bruin */
SELECT
  title,
  thief,
  flight,
  COUNT(*)                 AS runs,
  ROUND(AVG(turns), 1)     AS avg_turns,
  STRING_AGG(DISTINCT rode_down, ' | ') AS who_rode_down
FROM film.raw_runs
GROUP BY title, thief, flight
ORDER BY runs DESC
