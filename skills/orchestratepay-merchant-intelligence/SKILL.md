---
name: orchestratepay-merchant-intelligence
description: >
  Build the OrchestratePay merchant analytics and BI engine.
  Covers transaction pattern analysis, hourly/daily/weekly aggregations,
  peak-hour detection, revenue trend reporting, the analytics API endpoints,
  the React dashboard charts, and the PostgreSQL materialized views that power them.
  Use this skill for: merchant dashboard analytics, revenue charts, peak sales
  detection, transaction volume trends, comparative period reporting (week-on-week,
  month-on-month), top payment sources, and data export (CSV/PDF).
---

# OrchestratePay — Merchant Intelligence & Predictive Analytics

## Data model — what we already have

Every `CONFIRMED` transaction in the `transactions` table has:
- `merchant_id` — which merchant
- `amount_cents` — revenue
- `source` — NFC_TAG | HCE_PHONE | QR_CODE
- `created_at` — when (stored UTC, displayed in Africa/Nairobi UTC+3)
- `consumer_id` → `consumers.phone` — which customer

This is a rich event log. Analytics are SQL aggregations over this table.

## Materialized views (pre-aggregate for dashboard speed)

```sql
-- Hourly revenue by merchant (refreshed every 15 minutes)
CREATE MATERIALIZED VIEW mv_hourly_revenue AS
SELECT
  merchant_id,
  date_trunc('hour', created_at AT TIME ZONE 'Africa/Nairobi') AS hour_nairobi,
  COUNT(*) FILTER (WHERE status = 'CONFIRMED')                  AS confirmed_count,
  SUM(amount_cents) FILTER (WHERE status = 'CONFIRMED')         AS revenue_cents,
  COUNT(*) FILTER (WHERE status = 'DECLINED')                   AS declined_count
FROM transactions
GROUP BY merchant_id, hour_nairobi;

CREATE UNIQUE INDEX ON mv_hourly_revenue (merchant_id, hour_nairobi);

-- Refresh concurrently — no table lock, reads keep working
SELECT cron.schedule('refresh-hourly-revenue', '*/15 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hourly_revenue');
```

## Analytics API endpoints

### Weekly summary
```
GET /api/v1/merchants/me/analytics/weekly?weeks=4
```
Returns revenue and transaction counts for the last N weeks, week-over-week delta.

```typescript
router.get('/me/analytics/weekly', requireAuth, async (req, res) => {
  const weeks  = Math.min(parseInt(req.query.weeks as string) || 4, 52)
  const result = await db.query(`
    SELECT
      date_trunc('week', hour_nairobi)::date AS week_start,
      SUM(revenue_cents)                     AS revenue_cents,
      SUM(confirmed_count)                   AS confirmed_count,
      SUM(declined_count)                    AS declined_count
    FROM mv_hourly_revenue
    WHERE merchant_id = $1
      AND hour_nairobi >= NOW() - ($2 || ' weeks')::interval
    GROUP BY week_start
    ORDER BY week_start ASC
  `, [req.merchant!.sub, weeks])
  res.json(result.rows)
})
```

### Peak hours
```
GET /api/v1/merchants/me/analytics/peak-hours
```
Returns the average revenue by hour-of-day and day-of-week — tells the merchant
when their busiest trading hours are.

```typescript
router.get('/me/analytics/peak-hours', requireAuth, async (req, res) => {
  const result = await db.query(`
    SELECT
      EXTRACT(DOW  FROM hour_nairobi) AS day_of_week,  -- 0=Sun, 6=Sat
      EXTRACT(HOUR FROM hour_nairobi) AS hour_of_day,
      AVG(revenue_cents)::bigint      AS avg_revenue_cents,
      AVG(confirmed_count)::int       AS avg_transactions
    FROM mv_hourly_revenue
    WHERE merchant_id = $1
      AND hour_nairobi >= NOW() - INTERVAL '90 days'
    GROUP BY day_of_week, hour_of_day
    ORDER BY day_of_week, hour_of_day
  `, [req.merchant!.sub])
  res.json(result.rows)
})
```

### Payment source breakdown
```
GET /api/v1/merchants/me/analytics/sources?days=30
```
Shows split between NFC_TAG taps, HCE_PHONE taps, and QR_CODE scans.

```typescript
router.get('/me/analytics/sources', requireAuth, async (req, res) => {
  const days = Math.min(parseInt(req.query.days as string) || 30, 365)
  const result = await db.query(`
    SELECT
      source,
      COUNT(*)          AS count,
      SUM(amount_cents) AS revenue_cents
    FROM transactions
    WHERE merchant_id = $1
      AND status = 'CONFIRMED'
      AND created_at >= NOW() - ($2 || ' days')::interval
    GROUP BY source
  `, [req.merchant!.sub, days])
  res.json(result.rows)
})
```

## React dashboard charts

```typescript
// dashboard/src/pages/AnalyticsPage.tsx
// Uses Recharts (already common in Vite/React stacks)

import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// Weekly revenue trend
<ResponsiveContainer width="100%" height={240}>
  <LineChart data={weeklyData}>
    <XAxis dataKey="week_start" tickFormatter={d => format(new Date(d), 'dd MMM')} />
    <YAxis tickFormatter={v => `KSh ${(v/100).toLocaleString()}`} />
    <Tooltip formatter={(v: number) => [`KSh ${(v/100).toFixed(2)}`, 'Revenue']} />
    <Line type="monotone" dataKey="revenue_cents" stroke="#4CAF50" strokeWidth={2} dot={false} />
  </LineChart>
</ResponsiveContainer>

// Peak hours heatmap — 7 days × 24 hours grid
// Colour intensity = avg_revenue_cents / max_revenue_cents
```

## Predictive "Friday spike" alert

```typescript
// Simple rule-based pattern detection — no ML required for v1
async function checkFridaySpike(merchantId: string): Promise<string | null> {
  const { rows } = await db.query(`
    SELECT
      EXTRACT(DOW FROM hour_nairobi) AS dow,
      AVG(revenue_cents) AS avg
    FROM mv_hourly_revenue
    WHERE merchant_id = $1
      AND hour_nairobi >= NOW() - INTERVAL '90 days'
    GROUP BY dow
    ORDER BY avg DESC
    LIMIT 1
  `, [merchantId])

  if (!rows[0]) return null
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const topDay = DAYS[rows[0].dow]
  return `Your busiest day is ${topDay} — consider having extra staff and printer paper ready.`
}
```

## Privacy guardrails

- Consumer phone numbers in analytics are always masked (`25471****78`)
- `consumer_id` (UUID) may appear in aggregations; the raw phone is never exposed
- Analytics endpoints require `requireAuth` — merchant can only see their own data
- No cross-merchant queries — every query is `WHERE merchant_id = $1`

## Key invariants

1. Materialized views are refreshed concurrently — no read locks on the transactions table
2. All time calculations use `AT TIME ZONE 'Africa/Nairobi'` — day boundaries match merchant expectations
3. Revenue = `SUM(amount_cents) WHERE status = 'CONFIRMED'` only
4. Analytics endpoints cap the time window (`LIMIT 52 weeks`) to prevent runaway queries
5. Consumer PII is never returned in analytics responses
