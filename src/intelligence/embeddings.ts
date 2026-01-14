/**
 * KERNL MCP - Embeddings Engine
 * 
 * Local embeddings using ONNX for semantic search.
 * Uses all-MiniLM-L6-v2 model for high-quality, fast embeddings.
 * 
 * Key features:
 * - Local inference (no API calls)
 * - ~50ms per query
 * - 384-dimensional embeddings
 * - Automatic caching of model
 */

import { pipeline, env } from '@xenova/transformers';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure model cache location
env.cacheDir = join(__dirname, '..', '..', 'models');
env.allowLocalModels = true;

// Type for the pipeline instance
type EmbeddingPipeline = Awaited<ReturnType<typeof pipeline>>;

// Singleton instance
let embeddingPipeline: EmbeddingPipeline | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the embeddings pipeline.
 * Downloads model on first run (~90MB), then uses cached version.
 */
async function initialize(): Promise<void> {
  if (embeddingPipeline) return;
  
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    console.error('[Embeddings] Loading model (first run will download ~90MB)...');
    const startTime = Date.now();
    
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { 
        quantized: true,  // Use quantized model for faster inference
      }
    );
    
    const elapsed = Date.now() - startTime;
    console.error(`[Embeddings] Model loaded in ${elapsed}ms`);
  })();

  await initPromise;
}

/**
 * Generate embedding for a single text.
 * 
 * @param text - Text to embed
 * @returns 384-dimensional embedding as Float32Array
 */
export async function embed(text: string): Promise<Float32Array> {
  await initialize();
  
  if (!embeddingPipeline) {
    throw new Error('Embeddings pipeline not initialized');
  }

  // Truncate very long texts (model has 512 token limit)
  const truncatedText = text.slice(0, 8000);
  
  // Use type assertion for complex pipeline types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = await (embeddingPipeline as any)(truncatedText, {
    pooling: 'mean',
    normalize: true,
  });
  
  // Convert to Float32Array - output is a Tensor with data property
  return new Float32Array(output.data);
}

/**
 * Generate embeddings for multiple texts.
 * 
 * @param texts - Array of texts to embed
 * @returns Array of 384-dimensional embeddings
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  await initialize();
  
  if (!embeddingPipeline) {
    throw new Error('Embeddings pipeline not initialized');
  }

  const embeddings: Float32Array[] = [];
  
  // Process in batches to avoid memory issues
  const batchSize = 32;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    
    for (const text of batch) {
      const truncatedText = text.slice(0, 8000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output = await (embeddingPipeline as any)(truncatedText, {
        pooling: 'mean',
        normalize: true,
      });
      embeddings.push(new Float32Array(output.data));
    }
  }
  
  return embeddings;
}

/**
 * Calculate cosine similarity between two embeddings.
 * Both vectors should already be normalized.
 * 
 * @param a - First embedding
 * @param b - Second embedding
 * @returns Similarity score between -1 and 1
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimensions don't match: ${a.length} vs ${b.length}`);
  }
  
  let dotProduct = 0;
  
  // Since embeddings are normalized, dot product = cosine similarity
  for (let i = 0; i < a.length; i++) {
    dotProduct += (a[i] ?? 0) * (b[i] ?? 0);
  }
  
  return dotProduct;
}

/**
 * Find most similar embeddings from a collection.
 * 
 * @param queryEmbedding - The query embedding
 * @param candidates - Array of candidates with id and embedding
 * @param limit - Maximum results to return
 * @param minSimilarity - Minimum similarity threshold
 * @returns Sorted array of matches with similarity scores
 */
export function findSimilar(
  queryEmbedding: Float32Array,
  candidates: Array<{ id: string | number; embedding: Float32Array }>,
  limit: number = 10,
  minSimilarity: number = 0.0
): Array<{ id: string | number; similarity: number }> {
  const results = candidates
    .map(candidate => ({
      id: candidate.id,
      similarity: cosineSimilarity(queryEmbedding, candidate.embedding),
    }))
    .filter(result => result.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
  
  return results;
}

/**
 * Serialize embedding to Buffer for database storage.
 */
export function serializeEmbedding(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

/**
 * Deserialize embedding from database storage.
 */
export function deserializeEmbedding(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
}

/**
 * Get embedding dimension (for schema validation).
 */
export function getEmbeddingDimension(): number {
  return 384;
}

/**
 * Check if embeddings engine is ready.
 */
export function isReady(): boolean {
  return embeddingPipeline !== null;
}

/**
 * Preload the model (call at startup for faster first query).
 */
export async function preload(): Promise<void> {
  await initialize();
}
