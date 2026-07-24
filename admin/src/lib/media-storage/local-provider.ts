import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type {
  MediaStorageLocation,
  MediaStorageProvider,
  PutMediaObjectInput,
  StoredMediaObject,
} from './types';

function defaultStorageRoot() {
  return process.env.AI_ASSET_STORAGE_DIR?.trim()
    || path.join(/* turbopackIgnore: true */ process.cwd(), 'uploads', 'ai-assets');
}

function isOutsideRoot(relativePath: string) {
  return relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath);
}

export class LocalMediaStorageProvider implements MediaStorageProvider {
  readonly key = 'local';
  private readonly rootDirectory: string;

  constructor(rootDirectory = defaultStorageRoot()) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  private resolveObjectPath(objectKey: string) {
    const normalizedKey = String(objectKey || '').trim();
    if (!normalizedKey || path.isAbsolute(normalizedKey)) {
      throw new Error('Invalid local media object key');
    }

    const targetPath = path.resolve(this.rootDirectory, normalizedKey);
    const relativePath = path.relative(this.rootDirectory, targetPath);
    if (!relativePath || isOutsideRoot(relativePath)) {
      throw new Error('Media object key resolves outside the configured storage directory');
    }

    return targetPath;
  }

  async putObject(input: PutMediaObjectInput): Promise<StoredMediaObject> {
    const targetPath = this.resolveObjectPath(input.objectKey);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, input.buffer);
    return {
      checksumSha256: crypto.createHash('sha256').update(input.buffer).digest('hex'),
    };
  }

  async getObject(input: MediaStorageLocation) {
    return fs.readFile(this.resolveObjectPath(input.objectKey));
  }

  async deleteObject(input: MediaStorageLocation) {
    try {
      await fs.unlink(this.resolveObjectPath(input.objectKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async statObject(input: MediaStorageLocation) {
    const stat = await fs.stat(this.resolveObjectPath(input.objectKey));
    return { size: stat.size };
  }
}
