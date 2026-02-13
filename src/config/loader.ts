import { lilconfig } from 'lilconfig';
import { auditConfigSchema, type AuditConfigResolved } from './schema.js';

const explorer = lilconfig('a11y-audit', {
  searchPlaces: [
    'a11y-audit.config.js',
    'a11y-audit.config.mjs',
    'a11y-audit.config.ts',
    '.a11y-auditrc.json',
    'package.json',
  ],
});

export async function loadConfig(
  explicitPath?: string
): Promise<AuditConfigResolved> {
  const result = explicitPath
    ? await explorer.load(explicitPath)
    : await explorer.search();

  const raw = result?.config ?? {};
  return auditConfigSchema.parse(raw);
}
