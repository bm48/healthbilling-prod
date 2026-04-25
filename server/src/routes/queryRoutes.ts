import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { appendRowLevelSecurity, assertCanMutateReferenceData } from '../scope.js'

const filterSchema = z.object({
  op: z.enum(['eq', 'neq', 'in', 'is', 'gte', 'lte', 'lt', 'not', 'overlaps', 'contains']),
  column: z.string(),
  value: z.any().optional(),
  comparator: z.string().optional(),
})

const querySchema = z.object({
  table: z.string().min(1),
  action: z.enum(['select', 'insert', 'update', 'upsert', 'delete']),
  select: z.string().optional(),
  filters: z.array(filterSchema).default([]),
  orders: z.array(z.object({ column: z.string(), ascending: z.boolean().default(true) })).default([]),
  limit: z.number().int().positive().optional(),
  values: z.record(z.any()).optional(),
  rows: z.array(z.record(z.any())).optional(),
  onConflict: z.string().optional(),
  count: z.enum(['exact']).optional(),
  head: z.boolean().optional(),
  single: z.boolean().optional(),
  maybeSingle: z.boolean().optional(),
})

function quoteIdent(value: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error(`Invalid identifier: ${value}`)
  }
  return `"${value}"`
}

function mapTable(table: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(table)) {
    throw new Error('Invalid table')
  }
  return `public.${quoteIdent(table)}`
}

function buildWhere(filters: z.infer<typeof filterSchema>[], params: unknown[]): string {
  const clauses: string[] = []
  for (const filter of filters) {
    const col = quoteIdent(filter.column)
    switch (filter.op) {
      case 'eq':
        params.push(filter.value)
        clauses.push(`${col} = $${params.length}`)
        break
      case 'neq':
        params.push(filter.value)
        clauses.push(`${col} <> $${params.length}`)
        break
      case 'gte':
        params.push(filter.value)
        clauses.push(`${col} >= $${params.length}`)
        break
      case 'lte':
        params.push(filter.value)
        clauses.push(`${col} <= $${params.length}`)
        break
      case 'lt':
        params.push(filter.value)
        clauses.push(`${col} < $${params.length}`)
        break
      case 'is':
        clauses.push(filter.value === null ? `${col} IS NULL` : `${col} IS NOT NULL`)
        break
      case 'in': {
        const values = Array.isArray(filter.value) ? filter.value : []
        if (values.length === 0) {
          clauses.push('false')
          break
        }
        const placeholders = values.map((v) => {
          params.push(v)
          return `$${params.length}`
        })
        clauses.push(`${col} IN (${placeholders.join(', ')})`)
        break
      }
      case 'not': {
        const comparator = filter.comparator ?? 'eq'
        params.push(filter.value)
        const op = comparator === 'eq' ? '<>' : comparator
        clauses.push(`${col} ${op} $${params.length}`)
        break
      }
      case 'overlaps':
        params.push(filter.value)
        clauses.push(`${col} && $${params.length}`)
        break
      case 'contains': {
        const arr = Array.isArray(filter.value) ? filter.value : []
        if (arr.length === 0) {
          clauses.push('false')
          break
        }
        params.push(arr)
        clauses.push(`${col} @> $${params.length}::uuid[]`)
        break
      }
    }
  }
  return clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''
}

function mergeWhere(baseWhere: string, securitySql: string): string {
  if (!securitySql) return baseWhere
  if (baseWhere) return `${baseWhere}${securitySql}`
  return ` WHERE true${securitySql}`
}

export const queryRoutes = Router()
queryRoutes.use(requireAuth)

queryRoutes.post('/query', async (req, res) => {
  const parsed = querySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }
  const input = { ...parsed.data, filters: [...parsed.data.filters] }
  const authUser = req.authUser!
  const forbidden = assertCanMutateReferenceData(input.table, input.action, authUser)
  if (forbidden) {
    res.status(403).json({ data: null, error: { message: forbidden } })
    return
  }

  if (input.table === 'users' && !['super_admin', 'admin'].includes(authUser.role)) {
    input.filters.push({ op: 'eq', column: 'id', value: authUser.id })
  }

  const table = mapTable(input.table)
  const params: unknown[] = []
  const baseWhere = buildWhere(input.filters, params)
  const securitySql = appendRowLevelSecurity(input.table, authUser, params)
  const where = mergeWhere(baseWhere, securitySql)

  const selectColumns =
    input.select && input.select !== '*'
      ? input.select
          .split(',')
          .map((c) => quoteIdent(c.trim()))
          .join(', ')
      : '*'
  const orderBy = input.orders.length
    ? ` ORDER BY ${input.orders.map((o) => `${quoteIdent(o.column)} ${o.ascending ? 'ASC' : 'DESC'}`).join(', ')}`
    : ''
  const limit = input.limit ? ` LIMIT ${input.limit}` : ''

  try {
    if (input.action === 'select') {
      const countSql =
        input.count === 'exact' ? `SELECT count(*)::int AS total FROM ${table}${where}` : null
      const dataSql = `SELECT ${selectColumns} FROM ${table}${where}${orderBy}${limit}`
      const [countResult, dataResult] = await Promise.all([
        countSql ? pool.query(countSql, params) : Promise.resolve(null),
        input.head ? Promise.resolve({ rows: [] as Record<string, unknown>[] }) : pool.query(dataSql, params),
      ])
      let data: unknown = dataResult.rows
      if (input.single) {
        if (dataResult.rows.length !== 1) {
          res.status(406).json({
            data: null,
            error: { message: 'Expected single row' },
            count: countResult?.rows[0]?.total ?? null,
          })
          return
        }
        data = dataResult.rows[0]
      } else if (input.maybeSingle) {
        data = dataResult.rows[0] ?? null
      }
      res.json({ data, error: null, count: countResult?.rows[0]?.total ?? null })
      return
    }

    if (input.action === 'insert') {
      const payload = input.values ?? {}
      const keys = Object.keys(payload)
      const cols = keys.map(quoteIdent).join(', ')
      const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ')
      const values = keys.map((k) => payload[k])
      const sql = `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`
      const result = await pool.query(sql, values)
      res.json({
        data: input.single || input.maybeSingle ? (result.rows[0] ?? null) : result.rows,
        error: null,
      })
      return
    }

    if (input.action === 'update') {
      const payload = input.values ?? {}
      const keys = Object.keys(payload)
      const setParts = keys.map((k, idx) => `${quoteIdent(k)} = $${idx + 1}`)
      const setValues = keys.map((k) => payload[k])
      const whereParams: unknown[] = []
      const whereSql = buildWhere(input.filters, whereParams)
      const sec = appendRowLevelSecurity(input.table, authUser, whereParams)
      const fullWhere = mergeWhere(whereSql, sec)
      const translatedWhere = fullWhere.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + setValues.length}`)
      const sql = `UPDATE ${table} SET ${setParts.join(', ')}${translatedWhere} RETURNING *`
      const result = await pool.query(sql, [...setValues, ...whereParams])
      res.json({
        data: input.single || input.maybeSingle ? (result.rows[0] ?? null) : result.rows,
        error: null,
      })
      return
    }

    if (input.action === 'delete') {
      const sql = `DELETE FROM ${table}${where} RETURNING *`
      const result = await pool.query(sql, params)
      res.json({
        data: input.single || input.maybeSingle ? (result.rows[0] ?? null) : result.rows,
        error: null,
      })
      return
    }

    if (input.action === 'upsert') {
      const rows = input.rows && input.rows.length ? input.rows : [input.values ?? {}]
      const keys = Object.keys(rows[0] ?? {})
      const values: unknown[] = []
      const tuples = rows.map((row, rowIdx) => {
        const placeholders = keys.map((k, colIdx) => {
          values.push(row[k])
          return `$${rowIdx * keys.length + colIdx + 1}`
        })
        return `(${placeholders.join(', ')})`
      })
      const cols = keys.map(quoteIdent).join(', ')
      const conflict = input.onConflict
        ? input.onConflict
            .split(',')
            .map((x) => quoteIdent(x.trim()))
            .join(', ')
        : quoteIdent('id')
      const updates = keys.map((k) => `${quoteIdent(k)} = EXCLUDED.${quoteIdent(k)}`).join(', ')
      const sql = `INSERT INTO ${table} (${cols}) VALUES ${tuples.join(', ')} ON CONFLICT (${conflict}) DO UPDATE SET ${updates} RETURNING *`
      const result = await pool.query(sql, values)
      res.json({
        data: input.single || input.maybeSingle ? (result.rows[0] ?? null) : result.rows,
        error: null,
      })
      return
    }

    res.status(400).json({ error: 'Unsupported action' })
  } catch (error) {
    res.status(500).json({
      data: null,
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    })
  }
})
