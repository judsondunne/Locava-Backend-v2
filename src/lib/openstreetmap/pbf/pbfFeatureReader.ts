import fs from "node:fs/promises";
import path from "node:path";
import type { PbfAdapterMetadata, PbfRawEntity } from "./pbfElementAdapter.js";
import { enrichPbfEntityWithWayGeometry, type PbfNodeCoordCache } from "./pbfWayGeometryResolver.js";

/**
 * Pluggable streaming PBF reader.
 *
 * The reader is intentionally an interface so the actual PBF library
 * (`osm-pbf-parser-node`) is a soft optional dependency. Tests inject a
 * synthetic in-memory reader to exercise the entire pipeline without ever
 * touching a real `.osm.pbf` file, and the health endpoint reports
 * whether the parser library is available so the UI can warn the user.
 *
 * Why optional:
 *   - `osm-pbf-parser-node` is a 50 KB MIT-licensed library that reads the
 *     PBF format natively in Node. Adding it as a hard dependency would
 *     pull native deps into installs that never use the importer. We
 *     declare it as an optional dependency and dynamically import it at
 *     runtime, gracefully degrading the importer UI when it is not
 *     installed.
 *   - Tests never need the real parser; they hand the runner a synthetic
 *     stream.
 */

export const PBF_IMPORTER_VERSION = "pbf_copier_v1";

export type PbfReaderProgressEvent = {
  bytesRead?: number;
  bytesTotal?: number;
  nodes: number;
  ways: number;
  relations: number;
};

export type PbfReaderOpenResult = {
  parserId: string;
  parserVersion?: string;
  filePath: string;
  fileSizeBytes: number;
  /** Best-effort source timestamp if the PBF header exposes it. */
  sourceTimestamp?: string;
  /** Optional bounding box from the PBF header. */
  headerBbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
};

export type PbfReaderEntityChunk = {
  /** Raw PBF entities (already shape-adapted by the reader). */
  entities: PbfRawEntity[];
  /** Bytes read up to the end of this chunk, if the parser knows. */
  bytesRead?: number;
};

export interface PbfFeatureReader {
  /** Open the file and return reader-level metadata. */
  open(opts: { filePath: string }): Promise<PbfReaderOpenResult>;

  /** Async iterable of entity chunks. */
  read(): AsyncIterable<PbfReaderEntityChunk>;

  /** Close any underlying resources. Safe to call multiple times. */
  close(): Promise<void>;

  /** Stable identifier (used in health output and import metadata). */
  readonly parserId: string;
  /** Optional version string (e.g. "1.1.4"). */
  readonly parserVersion?: string;
}

export type PbfFeatureReaderFactory = (opts: { filePath: string }) => Promise<PbfFeatureReader>;

/**
 * Returns adapter metadata pre-filled for use with
 * `adaptPbfEntityToOverpassElement`. Each entity that the reader emits
 * gets stamped with this metadata so downstream docs preserve where they
 * came from.
 */
export function buildPbfAdapterMetadata(input: {
  filePath: string;
  parserVersion?: string;
  sourceTimestamp?: string;
}): PbfAdapterMetadata {
  const base = path.basename(input.filePath ?? "").toLowerCase();
  let sourceProvider: PbfAdapterMetadata["sourceProvider"] = "pbf_unknown";
  if (base.includes("geofabrik") || base.includes("-latest.osm.pbf")) {
    sourceProvider = "geofabrik_pbf";
  } else if (base.endsWith(".osm.pbf")) {
    sourceProvider = "pbf_local";
  }
  return {
    sourceProvider,
    pbfFilePath: input.filePath,
    importerVersion: PBF_IMPORTER_VERSION,
    parserVersion: input.parserVersion,
    sourceTimestamp: input.sourceTimestamp,
  };
}

// ---------------------------------------------------------------------------
// Default reader — soft-loads osm-pbf-parser-node at runtime.
// ---------------------------------------------------------------------------

export type PbfFeatureReaderAvailability = {
  parserAvailable: boolean;
  parserId: string;
  parserVersion?: string;
  reason?: string;
};

let cachedAvailability: PbfFeatureReaderAvailability | null = null;

export async function probePbfParserAvailability(): Promise<PbfFeatureReaderAvailability> {
  if (cachedAvailability) return cachedAvailability;
  try {
    // Dynamic import keeps the parser optional. We accept any compatible
    // shape that exposes `createOSMStream`. The `@ts-ignore` is needed
    // because the optional dependency is not declared in package.json
    // `dependencies` and may not be installed.
    // @ts-ignore — optional dependency, may not be installed
    const mod = (await import("osm-pbf-parser-node").catch(() => null)) as
      | { createOSMStream?: unknown }
      | null;
    if (!mod || typeof mod.createOSMStream !== "function") {
      cachedAvailability = {
        parserAvailable: false,
        parserId: "osm-pbf-parser-node",
        reason: "module_not_installed",
      };
      return cachedAvailability;
    }
    cachedAvailability = {
      parserAvailable: true,
      parserId: "osm-pbf-parser-node",
    };
    return cachedAvailability;
  } catch (error) {
    cachedAvailability = {
      parserAvailable: false,
      parserId: "osm-pbf-parser-node",
      reason: error instanceof Error ? error.message : String(error),
    };
    return cachedAvailability;
  }
}

export function resetPbfParserAvailabilityCacheForTests(): void {
  cachedAvailability = null;
}

type CreateOSMStreamFn = (
  filePath: string,
  opts?: Record<string, unknown>
) => AsyncIterable<unknown> | AsyncIterator<unknown>;

function flushEntityBuffer(buffer: PbfRawEntity[], chunkSize: number): PbfReaderEntityChunk[] {
  const out: PbfReaderEntityChunk[] = [];
  while (buffer.length >= chunkSize) {
    const slice = buffer.splice(0, chunkSize);
    out.push({ entities: slice });
  }
  return out;
}

function enrichEntitiesFromStream(
  rawEntities: unknown[],
  nodeCache: PbfNodeCoordCache
): PbfRawEntity[] {
  const enriched: PbfRawEntity[] = [];
  for (const raw of rawEntities) {
    const entity = enrichPbfEntityWithWayGeometry(raw as PbfRawEntity, nodeCache);
    if (entity) enriched.push(entity);
  }
  return enriched;
}

/**
 * Default reader factory. Tries to load `osm-pbf-parser-node`; falls back
 * to a clear "parser not installed" error when unavailable. The factory
 * itself never reads the file unless the parser is present, so tests can
 * detect availability without doing IO.
 */
export const defaultPbfFeatureReaderFactory: PbfFeatureReaderFactory = async ({ filePath }) => {
  const availability = await probePbfParserAvailability();
  if (!availability.parserAvailable) {
    throw new Error(
      `pbf_parser_not_installed:osm-pbf-parser-node is required to scan PBF files. Install with: npm install osm-pbf-parser-node`
    );
  }
  // @ts-ignore — optional dependency, may not be installed
  const mod = (await import("osm-pbf-parser-node")) as { createOSMStream: CreateOSMStreamFn };
  const stat = await fs.stat(filePath);

  let closed = false;
  const reader: PbfFeatureReader = {
    parserId: availability.parserId,
    parserVersion: availability.parserVersion,
    async open() {
      return {
        parserId: availability.parserId,
        parserVersion: availability.parserVersion,
        filePath,
        fileSizeBytes: stat.size,
      };
    },
    async *read() {
      const stream = mod.createOSMStream(filePath, { withInfo: false }) as AsyncIterable<unknown>;
      const buffer: PbfRawEntity[] = [];
      const nodeCache: PbfNodeCoordCache = new Map();
      const chunkSize = 4096;
      for await (const entity of stream) {
        if (closed) break;
        const enriched = enrichEntitiesFromStream([entity], nodeCache);
        buffer.push(...enriched);
        for (const chunk of flushEntityBuffer(buffer, chunkSize)) {
          yield chunk;
        }
      }
      if (buffer.length > 0) yield { entities: buffer.splice(0, buffer.length) };
    },
    async close() {
      closed = true;
    },
  };
  return reader;
};

// ---------------------------------------------------------------------------
// Synthetic reader for tests — yields a fixed list of entities deterministically.
// ---------------------------------------------------------------------------

export type SyntheticPbfFeatureReaderInput = {
  filePath?: string;
  fileSizeBytes?: number;
  entities: PbfRawEntity[];
  chunkSize?: number;
};

export function createSyntheticPbfFeatureReader(
  input: SyntheticPbfFeatureReaderInput
): PbfFeatureReader {
  const chunkSize = input.chunkSize ?? 100;
  const filePath = input.filePath ?? "./synthetic.osm.pbf";
  const fileSizeBytes = input.fileSizeBytes ?? input.entities.length * 64;
  let bytesRead = 0;
  let closed = false;
  return {
    parserId: "synthetic-pbf-reader",
    parserVersion: "test",
    async open() {
      return {
        parserId: "synthetic-pbf-reader",
        parserVersion: "test",
        filePath,
        fileSizeBytes,
      };
    },
    async *read() {
      const entities = input.entities;
      const nodeCache: PbfNodeCoordCache = new Map();
      for (let i = 0; i < entities.length; i += chunkSize) {
        if (closed) break;
        const slice = enrichEntitiesFromStream(entities.slice(i, i + chunkSize), nodeCache);
        bytesRead += slice.length * 64;
        yield { entities: slice, bytesRead: Math.min(bytesRead, fileSizeBytes) };
        // Yield to event loop so progress polling can observe state changes.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    },
    async close() {
      closed = true;
    },
  };
}

export function buildSyntheticReaderFactory(
  input: SyntheticPbfFeatureReaderInput
): PbfFeatureReaderFactory {
  return async () => createSyntheticPbfFeatureReader(input);
}
