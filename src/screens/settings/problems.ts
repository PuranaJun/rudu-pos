import { CatalogError } from '../../db/catalog-repo.ts';

/** A refused save's reasons, or whatever else went wrong, as lines for the screen. */
export function problemsOf(cause: unknown): string[] {
  return cause instanceof CatalogError ? cause.problems : [String(cause)];
}
