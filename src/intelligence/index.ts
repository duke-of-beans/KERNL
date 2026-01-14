/**
 * KERNL MCP - Intelligence Layer
 * 
 * Local AI-powered features for semantic search and pattern recognition.
 */

export {
  embed,
  embedBatch,
  cosineSimilarity,
  findSimilar,
  serializeEmbedding,
  deserializeEmbedding,
  getEmbeddingDimension,
  isReady,
  preload,
} from './embeddings.js';
