/**
 * What one cup actually contains, after the operator's selections.
 *
 * Both the cost engine and the stock engine ask this question, and they must
 * never answer it differently: a cup that costs 35 ml of concentrate but
 * deducts 50 makes COGS and stock disagree, and nothing downstream can tell
 * which one is lying. So it is answered once, here.
 *
 * Pure. No React, no Dexie, no recipe knowledge — a modifier says what it does
 * through its columns, not through its id.
 */
import type { Bom, Component, ComponentRole, Modifier } from '../db/types.ts';

/** The catalog rows a recipe needs. CostCatalog satisfies this structurally. */
export interface RecipeCatalog {
  components: ReadonlyMap<string, Component>;
  bomByVariant: ReadonlyMap<string, readonly Bom[]>;
  modifiers: ReadonlyMap<string, Modifier>;
}

export interface RecipeLine {
  component: Component;
  /** Quantity for one cup, in the component's own unit. */
  qty: number;
  /**
   * Where the line came from. Modifier lines are real consumption but they
   * never limit how many cups of a drink can be sold (CLAUDE.md §2.2).
   */
  source: 'BOM' | 'MODIFIER';
}

/**
 * The component lines of one cup: the variant's bill of materials with any
 * role overrides applied, followed by the components the chosen modifiers add.
 *
 * Flat-cost modifiers with no component of their own (salted plum) are not
 * lines — they are a cost, not a thing to deduct.
 */
export function recipeFor(
  catalog: RecipeCatalog,
  variantId: string,
  modifierIds: readonly string[] = [],
): RecipeLine[] {
  const bom = catalog.bomByVariant.get(variantId);
  if (!bom) throw new Error(`no bill of materials for variant ${variantId}`);

  const modifiers = resolveModifiers(catalog, modifierIds);

  // "Less sweet" is 35 ml of concentrate instead of 50, made up with dilution
  // water. Which component that is depends on the drink, so the modifier names
  // the role and the catalog says which component plays it.
  const overrides = new Map<ComponentRole, number>();
  for (const mod of modifiers) {
    if (mod.overrides_component_role !== null && mod.qty_per_cup !== null) {
      overrides.set(mod.overrides_component_role, mod.qty_per_cup);
    }
  }

  const lines: RecipeLine[] = bom.map((row) => {
    const component = requireComponent(catalog, row.component_id);
    return {
      component,
      qty: overrides.get(component.role) ?? row.qty_per_cup,
      source: 'BOM',
    };
  });

  for (const mod of modifiers) {
    if (mod.component_id === null) continue;
    lines.push({
      component: requireComponent(catalog, mod.component_id),
      qty: mod.qty_per_cup ?? 0,
      source: 'MODIFIER',
    });
  }

  return lines;
}

export function resolveModifiers(
  catalog: RecipeCatalog,
  modifierIds: readonly string[],
): Modifier[] {
  return modifierIds.map((id) => {
    const mod = catalog.modifiers.get(id);
    if (!mod) throw new Error(`modifier ${id} not in the catalog`);
    return mod;
  });
}

/**
 * A row pointing at a component that no longer exists is a data fault that
 * would quietly understate cost and stock. Fail loudly instead.
 */
export function requireComponent(catalog: RecipeCatalog, componentId: string): Component {
  const component = catalog.components.get(componentId);
  if (!component) throw new Error(`component ${componentId} not in the catalog`);
  return component;
}
