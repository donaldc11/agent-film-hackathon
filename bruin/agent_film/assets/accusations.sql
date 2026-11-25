/* @bruin
name: film.accusations
type: duckdb.sql
description: Across all runs, who was accused or searched most, and by whom.
materialization:
  type: table
depends:
  - film.raw_decisions
@bruin */
SELECT
  target       AS suspect,
  action,
  agent        AS by_agent,
  COUNT(*)     AS times
FROM film.raw_decisions
WHERE action IN ('accuse', 'search', 'plant')
GROUP BY target, action, agent
ORDER BY times DESC
