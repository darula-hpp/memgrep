import { homedir } from 'node:os';
import path from 'node:path';
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

export const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

// By default Transformers.js caches models inside its own node_modules folder,
// which is not writable when the package is installed globally (EACCES on
// `npm install -g`). Cache in the user's home instead; this also lets the
// model survive package upgrades. MEMGREP_HOME keeps everything in one place.
env.cacheDir = path.join(
  process.env.MEMGREP_HOME ?? path.join(homedir(), '.memgrep'),
  'models',
);

/**
 * Wraps a Transformers.js feature-extraction pipeline.
 * Models run locally via ONNX (WASM/CPU); weights are downloaded from the
 * Hugging Face Hub on first use and cached on disk afterwards.
 */
export class Embedder {
  private constructor(
    readonly model: string,
    readonly dimensions: number,
    private readonly pipe: FeatureExtractionPipeline,
  ) {}

  static async create(model: string = DEFAULT_MODEL): Promise<Embedder> {
    const pipe = await pipeline('feature-extraction', model);
    // Probe once to discover the embedding dimension.
    const probe = await pipe('dimension probe', { pooling: 'mean', normalize: true });
    const dimensions = probe.dims[probe.dims.length - 1];
    return new Embedder(model, dimensions, pipe);
  }

  /** Embed a batch of texts into L2-normalized vectors. */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const output = await this.pipe(texts, { pooling: 'mean', normalize: true });
    const flat = output.data as Float32Array;
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      vectors.push(Array.from(flat.subarray(i * this.dimensions, (i + 1) * this.dimensions)));
    }
    return vectors;
  }

  async embedOne(text: string): Promise<number[]> {
    const [vector] = await this.embed([text]);
    return vector;
  }
}
