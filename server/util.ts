import { randomBytes } from 'node:crypto';
import { DATE_RE, ID_RE } from '../shared/constants';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** URL-safe random identifier (≈71 bits for the default length). */
export function newId(length = 12): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export const now = () => Date.now();

/** An error that is reported to the client with the given HTTP status. */
export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 429,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (message: string, code = 'invalid') => new HttpError(400, code, message);
export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const forbidden = (message = 'You do not have permission to do that') => new HttpError(403, 'forbidden', message);

/* ------------------------------ validation ------------------------------ */

type Body = Record<string, unknown>;

export function asBody(value: unknown): Body {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Expected a JSON object');
  return value as Body;
}

export function str(value: unknown, field: string, opts: { min?: number; max?: number; trim?: boolean } = {}): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`);
  const v = opts.trim === false ? value : value.trim();
  const min = opts.min ?? 0;
  const max = opts.max ?? 10_000;
  if (v.length < min) throw badRequest(min === 1 ? `${field} is required` : `${field} must be at least ${min} characters`);
  if (v.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return v;
}

export function optStr(value: unknown, field: string, opts: { min?: number; max?: number; trim?: boolean } = {}): string | undefined {
  return value === undefined ? undefined : str(value, field, opts);
}

export function int(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function num(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw badRequest(`${field} must be a number`);
  return value;
}

export function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw badRequest(`${field} must be a valid id`);
  return value;
}

export function idList(value: unknown, field: string, max = 1000): string[] {
  if (!Array.isArray(value) || value.length > max) throw badRequest(`${field} must be a list of ids`);
  return [...new Set(value.map((v) => id(v, field)))];
}

export function date(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw badRequest(`${field} must be a date in YYYY-MM-DD format`);
  }
  return value;
}

export function color(value: unknown, field = 'color'): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw badRequest(`${field} must be a hex color like #6366f1`);
  return value.toLowerCase();
}

export function email(value: unknown): string {
  const v = str(value, 'Email', { min: 3, max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(v)) throw badRequest('Email looks invalid');
  return v;
}

export function password(value: unknown): string {
  return str(value, 'Password', { min: 8, max: 200, trim: false });
}

/** Midpoint helper for fractional ordering. */
export function between(before: number | null | undefined, after: number | null | undefined): number {
  if (before == null && after == null) return 0;
  if (before == null) return (after as number) - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}
