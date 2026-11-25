/* @bruin
name: film.agent_activity
type: duckdb.sql
description: Who spoke, who acted, and how often their moves worked, across all runs.
materialization:
  type: table
depends:
  - film.raw_decisions
@bruin */
SELECT
  agent,
  COUNT(*)                                        AS decisions,
  COUNT(*) FILTER (WHERE say IS NOT NULL AND say <> '') AS lines_spoken,
  COUNT(*) FILTER (WHERE action NOT IN ('wait', 'talk')) AS actions_taken,
  ROUND(AVG(CASE WHEN ok THEN 1 ELSE 0 END), 2)   AS success_rate,
  COUNT(DISTINCT run_id)                          AS runs
FROM film.raw_decisions
GROUP BY agent
ORDER BY decisions DESC
