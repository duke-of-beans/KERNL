// Test 3-signal RRF recall quality
// Run from kernl-mcp root after build
const fs = require('fs');

async function test() {
  // Dynamic import of ESM module
  const mod = await import('./dist/tools/brain-tools.js');
  const handlers = mod.createBrainHandlers();
  
  const queries = [
    'HIRM consciousness',
    'what did I build last week',
    'brain.db RRF hybrid search improvements',
    'Vercel deployment issues',
    'GoDaddy DNS configuration',
  ];
  
  const results = {};
  for (const q of queries) {
    console.log(`\nQuery: "${q}"`);
    try {
      const r = await handlers.brain_recall({ query: q, limit: 5 });
      const res = r;
      console.log(`  Candidates: ${res.total_candidates}, Vector: ${res.vector_search}, Semantic: ${res.semantic_rerank}`);
      console.log(`  Top ${res.results.length} results:`);
      for (const item of res.results) {
        console.log(`    #${item.rank} [${item.score}] ${item.entity_name || '?'}: ${item.content.slice(0, 80)}...`);
      }
      results[q] = { candidates: res.total_candidates, semantic: res.semantic_rerank, topCount: res.results.length };
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      results[q] = { error: e.message };
    }
  }
  
  fs.writeFileSync('D:\\Meta\\recall_test_results.json', JSON.stringify(results, null, 2));
  console.log('\n--- Results saved to D:\\Meta\\recall_test_results.json ---');
  process.exit(0);
}

test().catch(e => { console.error(e); process.exit(1); });
