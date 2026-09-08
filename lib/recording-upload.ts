export interface RecordingChunk {
  blob: Blob;
  index: number;
  final: boolean;
}

/** Keep unacknowledged bytes until a retry succeeds, always in index order. */
export class RecordingUploadQueue {
  private pending: RecordingChunk[] = [];
  private running: Promise<void> | null = null;
  private failure: Error | null = null;
  private nextIndex = 0;
  private closed = false;
  private complete = false;

  constructor(
    private readonly send: (chunk: RecordingChunk) => Promise<void>,
    private readonly onError: (error: Error) => void,
  ) {}

  enqueue(blob: Blob, final = false): void {
    if (this.closed) throw new Error("Recording upload is already closed");
    this.pending.push({ blob, index: this.nextIndex++, final });
    this.closed = final;
    void this.pump();
  }

  get pendingBytes(): number {
    return this.pending.reduce((total, chunk) => total + chunk.blob.size, 0);
  }

  private pump(): Promise<void> {
    if (this.running) return this.running;
    if (this.failure) return Promise.resolve();
    this.running = (async () => {
      while (this.pending.length > 0) {
        const chunk = this.pending[0];
        try {
          await this.send(chunk);
        } catch (cause) {
          this.failure = cause instanceof Error ? cause : new Error("Recording upload failed");
          this.onError(this.failure);
          return;
        }
        this.pending.shift();
        if (chunk.final) this.complete = true;
      }
    })().finally(() => { this.running = null; });
    return this.running;
  }

  async finish(): Promise<void> {
    do { await this.pump(); } while (!this.failure && this.pending.length > 0);
    if (this.failure) throw this.failure;
    if (!this.complete) throw new Error("Recording has not been accepted for processing");
  }

  async retry(): Promise<void> {
    if (this.running) await this.running;
    this.failure = null;
    await this.finish();
  }
}

/** A 200 response alone is insufficient (for example a redirected login page). */
export function isUploadAcknowledged(body: unknown, final: boolean): boolean {
  if (!body || typeof body !== "object") return false;
  const data = body as Record<string, unknown>;
  return data.ok === true && (final
    ? data.status === "processing" && typeof data.recording_id === "string" && data.recording_id.length > 0
    : data.status === "chunk_received");
}
