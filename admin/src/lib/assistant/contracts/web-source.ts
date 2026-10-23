/** A public page captured by the server, not enterprise policy or a project fact. */
export type WebSourceLocator = {
  url: string; title: string; retrievedAt: string; hash: string;
  parser: 'public-html-text-v1' | 'crawl4ai-static-0.9.2+pypdf-6.21.2-v1'; textBytes: number;
  document?: { hash: string; mediaType: string; page: number; pages: number; bytes: number };
};
