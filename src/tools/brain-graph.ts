/**
 * brain-graph.ts — KERNL-BRAIN-01
 * Graph traversal helpers for brain.db brain_edges table.
 * Extracted from GregLite's graph-client.ts, adapted for KERNL's ESM context.
 * All functions accept db as a parameter — no module-level state.
 */

// ── Minimal DB interface (avoids better-sqlite3 export= ESM issues) ───────────

interface PreparedStmt {
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
}
interface BrainDB {
  prepare(sql: string): PreparedStmt;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NeighborResult {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  edge_relationship: string;
  edge_weight: number;
  direction: 'outbound' | 'inbound' | 'both';
}

export interface GraphEnrichedObservation {
  id: string;
  content: string;
  entity_id: string | null;
  entity_name: string | null;
  source: string;
  created_at: string;
  score: number;
  graph_boost: number;
  via_entity: string | null;
}

// ── getNeighborEntities ───────────────────────────────────────────────────────

export function getNeighborEntities(
  db: BrainDB,
  entityIds: string[],
  maxPerSeed = 6
): NeighborResult[] {
  if (entityIds.length === 0) return [];
  const results = new Map<string, NeighborResult>();

  for (const eid of entityIds) {
    try {
      const outbound = db.prepare(`
        SELECT be.target_entity_id as neighbor_id, be.relationship, be.weight,
               e.name as entity_name, e.type as entity_type
        FROM brain_edges be
        JOIN entities e ON e.id = be.target_entity_id
        WHERE be.source_entity_id = ?
          AND (be.valid_to IS NULL OR be.valid_to > datetime('now'))
        ORDER BY be.weight DESC LIMIT ?
      `).all(eid, maxPerSeed) as { neighbor_id: string; relationship: string; weight: number; entity_name: string; entity_type: string }[];

      for (const row of outbound) {
        const existing = results.get(row.neighbor_id);
        if (!existing || existing.edge_weight < row.weight) {
          results.set(row.neighbor_id, {
            entity_id: row.neighbor_id,
            entity_name: row.entity_name,
            entity_type: row.entity_type,
            edge_relationship: row.relationship,
            edge_weight: row.weight,
            direction: existing ? 'both' : 'outbound',
          });
        }
      }

      const inbound = db.prepare(`
        SELECT be.source_entity_id as neighbor_id, be.relationship, be.weight,
               e.name as entity_name, e.type as entity_type
        FROM brain_edges be
        JOIN entities e ON e.id = be.source_entity_id
        WHERE be.target_entity_id = ?
          AND (be.valid_to IS NULL OR be.valid_to > datetime('now'))
        ORDER BY be.weight DESC LIMIT ?
      `).all(eid, maxPerSeed) as { neighbor_id: string; relationship: string; weight: number; entity_name: string; entity_type: string }[];

      for (const row of inbound) {
        const existing = results.get(row.neighbor_id);
        if (!existing || existing.edge_weight < row.weight) {
          results.set(row.neighbor_id, {
            entity_id: row.neighbor_id,
            entity_name: row.entity_name,
            entity_type: row.entity_type,
            edge_relationship: row.relationship,
            edge_weight: row.weight,
            direction: existing ? 'both' : 'inbound',
          });
        }
      }
    } catch { /* degrade gracefully */ }
  }

  const seedSet = new Set(entityIds);
  return Array.from(results.values())
    .filter(r => !seedSet.has(r.entity_id))
    .sort((a, b) => b.edge_weight - a.edge_weight);
}

// ── getObservationsForEntities ────────────────────────────────────────────────

export function getObservationsForEntities(
  db: BrainDB,
  entityIds: string[],
  limitPerEntity = 3,
  edgeWeightMap: Map<string, number> = new Map()
): GraphEnrichedObservation[] {
  if (entityIds.length === 0) return [];
  const results: GraphEnrichedObservation[] = [];

  for (const eid of entityIds) {
    const edgeWeight = edgeWeightMap.get(eid) ?? 0.5;
    try {
      const rows = db.prepare(`
        SELECT o.id, o.content, o.entity_id, o.source, o.created_at,
               e.name as entity_name
        FROM observations o
        LEFT JOIN entities e ON e.id = o.entity_id
        WHERE o.entity_id = ? AND o.tenant_id = 'dk-001'
        ORDER BY (CASE WHEN o.embedding IS NOT NULL THEN 1 ELSE 0 END) DESC,
                 o.created_at DESC
        LIMIT ?
      `).all(eid, limitPerEntity) as { id: string; content: string; entity_id: string | null; source: string; created_at: string; entity_name: string | null }[];

      for (const row of rows) {
        results.push({
          id: row.id, content: row.content, entity_id: row.entity_id,
          entity_name: row.entity_name, source: row.source,
          created_at: row.created_at, score: edgeWeight,
          graph_boost: edgeWeight, via_entity: row.entity_name,
        });
      }
    } catch { /* degrade gracefully */ }
  }

  return results.sort((a, b) => b.graph_boost - a.graph_boost);
}

// ── buildGraphSummary ─────────────────────────────────────────────────────────

export function buildGraphSummary(
  seedEntityNames: string[],
  neighbors: NeighborResult[],
  neighborObs: GraphEnrichedObservation[]
): string {
  if (neighbors.length === 0) return '';
  const lines: string[] = ['RELATED CONTEXT (graph neighborhood):'];

  const byRel = new Map<string, string[]>();
  for (const n of neighbors.slice(0, 8)) {
    if (!byRel.has(n.edge_relationship)) byRel.set(n.edge_relationship, []);
    byRel.get(n.edge_relationship)!.push(n.entity_name);
  }
  for (const [rel, names] of byRel) {
    lines.push(`  ${rel}: ${names.join(', ')}`);
  }

  const topObs = neighborObs.slice(0, 4);
  if (topObs.length > 0) {
    lines.push('NEIGHBOR OBSERVATIONS:');
    for (const obs of topObs) {
      const snippet = obs.content.length > 150 ? obs.content.slice(0, 150) + '…' : obs.content;
      lines.push(`  [via ${obs.via_entity ?? 'unknown'}] ${snippet}`);
    }
  }

  return lines.join('\n');
}
