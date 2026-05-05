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
  'no-reply'
];

export const customLocalPartSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter a local part.')
  .max(32, 'Use 32 characters or fewer.')
  .regex(/^[a-z0-9._+-]+$/, 'Use lowercase letters, numbers, dots, underscores, plus signs, or hyphens.')
  .refine((value) => !RESERVED_LOCAL_PARTS.includes(value), 'That name is reserved.');

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isExpired(expiresAt: string) {
  return new Date(expiresAt).getTime() <= Date.now();
}
