export type MediaStorageLocation = {
  objectKey: string;
  bucket?: string;
};

export type PutMediaObjectInput = {
  objectKey: string;
  buffer: Buffer;
  contentType: string;
};

export type StoredMediaObject = {
  bucket?: string;
  checksumSha256?: string;
};

export type MediaObjectStat = {
  size: number;
  checksum?: string;
  contentType?: string;
};

export interface MediaStorageProvider {
  readonly key: string;

  /** Converts a logical asset key to the provider's persisted object key. */
  buildObjectKey?(objectKey: string): string;

  putObject(input: PutMediaObjectInput): Promise<StoredMediaObject>;

  getObject(input: MediaStorageLocation): Promise<Buffer>;

  deleteObject(input: MediaStorageLocation): Promise<void>;

  statObject?(input: MediaStorageLocation): Promise<MediaObjectStat>;

  createSignedReadUrl?(input: MediaStorageLocation & {
    expiresInSeconds: number;
  }): Promise<string>;
}
