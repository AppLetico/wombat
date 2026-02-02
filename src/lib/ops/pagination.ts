/**
 * Shared Pagination Schema
 *
 * Provides consistent pagination parameters across all list endpoints.
 * Enforces hard caps to prevent unbounded queries.
 */

import { z } from "zod";

/**
 * Maximum page size allowed by the server.
 * Any request exceeding this will be capped.
 */
export const MAX_PAGE_SIZE = 200;

/**
 * Default page size if not specified.
 */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Zod schema for pagination query parameters.
 */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(["asc", "desc"]).default("desc"),
  cursor: z.string().optional()
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Standard paginated response wrapper.
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

/**
 * Build a paginated response from a list of items.
 */
export function buildPaginatedResponse<T>(params: {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}): PaginatedResponse<T> {
  return {
    items: params.items,
    total: params.total,
    has_more: params.offset + params.items.length < params.total,
    limit: params.limit,
    offset: params.offset
  };
}

/**
 * Apply pagination to an array.
 * Useful for in-memory data sources.
 */
export function paginateArray<T>(
  items: T[],
  limit: number = DEFAULT_PAGE_SIZE,
  offset: number = 0
): PaginatedResponse<T> {
  const cappedLimit = Math.min(limit, MAX_PAGE_SIZE);
  const sliced = items.slice(offset, offset + cappedLimit);
  return {
    items: sliced,
    total: items.length,
    has_more: offset + sliced.length < items.length,
    limit: cappedLimit,
    offset
  };
}

/**
 * Merge pagination query with a filter schema.
 * Helper for extending base pagination with endpoint-specific filters.
 */
export function withPagination<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.merge(PaginationQuerySchema);
}
