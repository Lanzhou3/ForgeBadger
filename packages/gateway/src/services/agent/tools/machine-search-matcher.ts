import { Worker } from 'node:worker_threads';

export interface SearchMatchInput {
  files: Array<{ path: string; content: string | null }>;
  query: string;
  mode: 'literal' | 'regex';
  pathGlob?: string | undefined;
  lineOffset: number;
  limit: number;
}

export interface SearchMatchResult {
  matches: Array<{ path: string; line: number; text: string }>;
  scannedFiles: number;
  resume: { fileOffset: number; lineOffset: number } | null;
}

const SEARCH_TIMEOUT_MS = 2000;
const MAX_ACTIVE_SEARCHES = 4;
let activeSearches = 0;

// Only this fixed source is executable. User patterns and bounded file snapshots
// travel as structured data; both query regexes and glob regexes stay off the
// Gateway event loop. An inline worker also works in tsx and the compiled CLI.
const MATCHER_SOURCE = String.raw`
const { parentPort, workerData: input } = require('node:worker_threads');
function globPattern(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { out += '.*'; i++; }
      else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if ('\\^$.|+()[]{}'.includes(c)) out += '\\' + c;
    else out += c;
  }
  return new RegExp(out + '$');
}
try {
  const glob = input.pathGlob ? globPattern(input.pathGlob) : null;
  const query = input.mode === 'regex' ? new RegExp(input.query, 'i') : null;
  const literal = input.query.toLowerCase();
  const matches = [];
  let scannedFiles = 0;
  let resume = null;
  for (let fileOffset = 0; fileOffset < input.files.length; fileOffset++) {
    const file = input.files[fileOffset];
    scannedFiles++;
    if (file.content === null || glob && !glob.test(file.path)) continue;
    const lines = file.content.split('\n');
    for (let index = fileOffset === 0 ? input.lineOffset : 0; index < lines.length; index++) {
      const text = lines[index];
      if (query ? query.test(text) : text.toLowerCase().includes(literal)) {
        matches.push({ path: file.path, line: index + 1, text });
        if (matches.length >= input.limit) {
          resume = { fileOffset, lineOffset: index + 1 };
          break;
        }
      }
    }
    if (resume) break;
  }
  parentPort.postMessage({ matches, scannedFiles, resume });
} catch {
  parentPort.postMessage({ error: 'MACHINE_SEARCH_INVALID_PATTERN' });
}
`;

export async function matchSearchPage(input: SearchMatchInput, signal?: AbortSignal): Promise<SearchMatchResult> {
  if (signal?.aborted) throw new Error('MACHINE_SEARCH_CANCELLED');
  if (activeSearches >= MAX_ACTIVE_SEARCHES) throw new Error('MACHINE_SEARCH_BUSY: retry after another search finishes');
  const worker = new Worker(MATCHER_SOURCE, {
    eval: true, workerData: input, env: {}, execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 },
  });
  activeSearches++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result?: SearchMatchResult, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      // Wait for termination before freeing capacity or completing the call.
      // Keep the error listener until exit so shutdown cannot emit unhandled errors.
      void worker.terminate().then(() => {
        activeSearches--;
        if (error) reject(error);
        else resolve(result!);
      }, () => {
        activeSearches--;
        reject(new Error('MACHINE_SEARCH_WORKER_FAILED'));
      });
    };
    const cancel = () => finish(undefined, new Error('MACHINE_SEARCH_CANCELLED'));
    const timer = setTimeout(() => finish(undefined,
      new Error('MACHINE_SEARCH_TIMEOUT: simplify the pattern or narrow the search')), SEARCH_TIMEOUT_MS);
    worker.once('message', (result: SearchMatchResult | { error: string }) => {
      if ('error' in result) finish(undefined, new Error(result.error));
      else finish(result);
    });
    worker.once('error', () => finish(undefined, new Error('MACHINE_SEARCH_WORKER_FAILED')));
    worker.once('exit', () => finish(undefined, new Error('MACHINE_SEARCH_WORKER_FAILED')));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
