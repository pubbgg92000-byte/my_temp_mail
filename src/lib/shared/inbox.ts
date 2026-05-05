import { z } from 'zod';

export const RESERVED_LOCAL_PARTS = [
  'admin',
  'support',
  'billing',
  'root',
  'abuse',
  'postmaster',
  'security',
  'contact',
  'help',
  'sales',
  'info',
  'mail',
  'noreply',
  'no-reply',
  'system',
  'api',
  'www',
  'login',
  'signup',
  'dashboard',
  'privacy',
  'terms'
];

export function localPartFromInput(value: string) {
  return value.trim().split('@')[0].toLowerCase();
}

export function canonicalLocalPart(value: string) {
  return localPartFromInput(value).replace(/\./g, '');
}

export const customLocalPartSchema = z.preprocess(
  (value) => (typeof value === 'string' ? localPartFromInput(value) : value),
  z.string()
  .refine((value) => value.length > 0, 'Enter a local part.')
  .refine((value) => !value.includes('.'), 'Dots are not allowed because some services ignore dots in email addresses.')
  .refine((value) => value.length >= 3, 'Use at least 3 characters.')
  .max(32, 'Use 32 characters or fewer.')
  .regex(/^[a-z0-9_+-]+$/, 'Use lowercase letters, numbers, underscores, plus signs, or hyphens.')
  .refine((value) => !RESERVED_LOCAL_PARTS.includes(value), 'That name is reserved.')
);

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isExpired(expiresAt: string) {
  return new Date(expiresAt).getTime() <= Date.now();
}
