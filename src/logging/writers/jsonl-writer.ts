import fs from 'fs';
import path from 'path';

export type JsonlWriterOptions = {
  directory: string;
  filePrefix?: string; // default: text-logs
  retentionDays?: number; // default: 7
};

export class JsonlWriter<T extends Record<string, unknown>> {
  private readonly directory: string;
  private readonly filePrefix: string;
  private readonly retentionDays: number;
  private currentDateKey: string | null = null;
  private currentFileStream: fs.WriteStream | null = null;
  private closed: boolean = false;

  constructor(options: JsonlWriterOptions) {
    this.directory = options.directory;
    this.filePrefix = options.filePrefix || 'text-logs';
    this.retentionDays = options.retentionDays ?? 7;
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }
  }

  async append(entry: T): Promise<void> {
    // Silently ignore writes after close to avoid errors during shutdown
    if (this.closed) {
      return;
    }
    const dateKey = this.getDateKey();
    if (this.currentDateKey !== dateKey) {
      this.rotateStream(dateKey);
      this.currentDateKey = dateKey;
      // fire and forget cleanup - errors are non-critical (log rotation failure
      // doesn't block logging, and cleanup is best-effort)
      this.cleanupOldFiles().catch(() => {
        // Silently ignore cleanup errors - these are non-critical and shouldn't
        // block the logging operation. Cleanup failures (e.g., permission issues
        // or disk space) are logged separately by the cleanup method itself.
      });
    }
    const line = JSON.stringify(entry) + '\n';
    await this.writeLine(line);
  }

  async close(): Promise<void> {
    this.closed = true;
    await new Promise<void>(resolve => {
      if (this.currentFileStream) {
        this.currentFileStream.end(() => resolve());
        this.currentFileStream = null;
      } else {
        resolve();
      }
    });
  }

  private getDateKey(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private getFilePathFor(dateKey: string): string {
    return path.join(this.directory, `${this.filePrefix}-${dateKey}.jsonl`);
  }

  private rotateStream(dateKey: string): void {
    if (this.currentFileStream) {
      try {
        this.currentFileStream.end();
      } catch {
        // ignore
      }
      this.currentFileStream = null;
    }
    const filePath = this.getFilePathFor(dateKey);
    this.currentFileStream = fs.createWriteStream(filePath, { flags: 'a' });
  }

  private writeLine(line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.currentFileStream) {
        // Should not happen as rotateStream is called before
        return reject(new Error('Writer stream not initialized'));
      }
      this.currentFileStream.write(line, err => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async cleanupOldFiles(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.directory);
      const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
      for (const f of files) {
        if (!f.startsWith(this.filePrefix) || !f.endsWith('.jsonl')) continue;
        const full = path.join(this.directory, f);
        const stat = await fs.promises.stat(full);
        if (stat.mtime.getTime() < cutoff) {
          await fs.promises.unlink(full);
        }
      }
    } catch {
      // best effort
    }
  }
}
