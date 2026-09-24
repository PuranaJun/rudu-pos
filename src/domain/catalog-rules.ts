/**
 * What a catalog edit has to satisfy before it is saved.
 *
 * Pure, and deliberately short. The recipes have not been taste-tested and
 * will change (CLAUDE.md §2.1.7), so the rules only refuse what would break
 * the arithmetic — a negative cost, a jelly with no cut clock — never what is
 * merely unusual. Messages are Thai, for the settings screen.
 */
import type { Bom, Component, Modifier, Product, Variant } from '../db/types.ts';

export function checkProduct(product: Product): string[] {
  const problems: string[] = [];
  if (product.name_short_th.trim() === '') problems.push('ต้องมีชื่อสั้น');
  if (product.name_full_th.trim() === '') problems.push('ต้องมีชื่อเต็ม');
  if (!Number.isInteger(product.base_price) || product.base_price < 0) {
    problems.push('ราคาต้องเป็นตัวเลขไม่ติดลบ');
  }
  return problems;
}

export function checkVariant(variant: Variant): string[] {
  const problems: string[] = [];
  if (variant.name_th.trim() === '') problems.push('ต้องมีชื่อ');
  if (variant.price_override !== null && variant.price_override < 0) {
    problems.push('ราคาต้องไม่ติดลบ');
  }
  if (variant.packaging_set_id === '') problems.push('ต้องเลือกบรรจุภัณฑ์');
  return problems;
}

export function checkComponent(component: Component): string[] {
  const problems: string[] = [];
  if (component.name_th.trim() === '') problems.push('ต้องมีชื่อ');
  if (!(component.cost_per_unit >= 0)) problems.push('ต้นทุนต้องไม่ติดลบ');
  if (!(component.lead_time_hours >= 0)) problems.push('เวลาเตรียมต้องไม่ติดลบ');
  for (const value of [
    component.default_batch_qty,
    component.shelf_life_hours,
    component.cut_shelf_life_hours,
  ]) {
    if (value !== null && !(value > 0)) problems.push('จำนวนและอายุต้องมากกว่า 0');
  }
  if (component.lifecycle === 'SLAB_CUT' && component.cut_shelf_life_hours === null) {
    problems.push('เยลลี่ต้องมีอายุหลังตัด');
  }
  if (component.is_batch_tracked && component.default_batch_qty === null) {
    problems.push('ของที่นับสต็อกต้องมีจำนวนต่อครั้ง');
  }
  if ((component.source_component_id === null) !== (component.source_qty_per_unit === null)) {
    problems.push('ถ้าทำจากของอื่น ต้องระบุทั้งของและปริมาณ');
  }
  if (component.source_component_id === component.id) problems.push('ทำจากตัวเองไม่ได้');
  if (
    component.prep_start_by !== null &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(component.prep_start_by)
  ) {
    problems.push('เวลาเริ่มทำต้องเป็นแบบ 21:00');
  }
  return problems;
}

/** A recipe line. One row per component per variant: two would double-deduct. */
export function checkBomRow(row: Bom, others: readonly Bom[]): string[] {
  const problems: string[] = [];
  if (!(row.qty_per_cup > 0)) problems.push('ปริมาณต่อแก้วต้องมากกว่า 0');
  if (
    others.some(
      (other) =>
        other.id !== row.id &&
        other.variant_id === row.variant_id &&
        other.component_id === row.component_id,
    )
  ) {
    problems.push('ส่วนประกอบนี้อยู่ในสูตรแล้ว');
  }
  return problems;
}

export function checkModifier(modifier: Modifier): string[] {
  const problems: string[] = [];
  if (modifier.name_th.trim() === '') problems.push('ต้องมีชื่อ');
  if (modifier.price_delta < 0) problems.push('ราคาต้องไม่ติดลบ');
  if (
    modifier.component_id !== null &&
    !(modifier.qty_per_cup !== null && modifier.qty_per_cup > 0)
  ) {
    problems.push('ต้องระบุปริมาณต่อแก้ว');
  }
  return problems;
}
