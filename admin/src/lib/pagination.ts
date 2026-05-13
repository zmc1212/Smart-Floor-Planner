import { NextResponse } from 'next/server';

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginationResult {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Extracts pagination parameters from a request URL.
 * @param url The request URL string or URL object.
 * @param defaultLimit Default number of items per page (max 50).
 */
export function getPaginationParams(url: string | URL, defaultLimit = 20): PaginationParams {
  const searchParams = typeof url === 'string' ? new URL(url).searchParams : url.searchParams;
  
  let page = parseInt(searchParams.get('page') || '1');
  let limit = parseInt(searchParams.get('limit') || String(defaultLimit));

  // Sanitize
  if (isNaN(page) || page < 1) page = 1;
  if (isNaN(limit) || limit < 1) limit = defaultLimit;
  if (limit > 50) limit = 50;

  return {
    page,
    limit,
    skip: (page - 1) * limit
  };
}

/**
 * Creates a pagination metadata object.
 */
export function createPaginationMetadata(total: number, page: number, limit: number): PaginationResult {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
}
