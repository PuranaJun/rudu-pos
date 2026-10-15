/**
 * The owner's promotions (CLAUDE.md §4). Rows, edited in settings: nothing
 * about a promotion is compiled in.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type { Promotion } from './types.ts';
import { CatalogError } from './catalog-repo.ts';
import { newId } from '../lib/id.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** What is wrong with a promotion, in words the owner can act on. Empty: nothing. */
export function promotionProblems(promotion: Promotion): string[] {
  const wrong: string[] = [];
  if (promotion.name_th.trim() === '') wrong.push('ต้องมีชื่อโปรโมชั่น');
  if (
    promotion.kind === 'AMOUNT_OFF' &&
    !(Number.isInteger(promotion.amount) && promotion.amount > 0)
  ) {
    wrong.push('ลดกี่บาท ต้องมากกว่า 0');
  }
  if (
    promotion.kind === 'FIXED_PRICE' &&
    !(Number.isInteger(promotion.amount) && promotion.amount > 0)
  ) {
    wrong.push('ขายแก้วละกี่บาท ต้องมากกว่า 0');
  }
  if (promotion.kind === 'PERCENT_OFF' && !(promotion.percent > 0 && promotion.percent <= 100)) {
    wrong.push('ลดกี่ % ต้องอยู่ระหว่าง 1–100');
  }
  if (
    promotion.kind === 'BUY_X_GET_Y' &&
    !(
      Number.isInteger(promotion.buy_qty) &&
      promotion.buy_qty >= 1 &&
      Number.isInteger(promotion.free_qty) &&
      promotion.free_qty >= 1
    )
  ) {
    wrong.push('ซื้อกี่แก้ว แถมกี่แก้ว ต้องเป็นจำนวนเต็มตั้งแต่ 1');
  }
  for (const date of [promotion.starts_on, promotion.ends_on]) {
    if (date !== null && !DATE.test(date)) wrong.push('วันที่ไม่ถูกต้อง');
  }
  if (promotion.starts_on && promotion.ends_on && promotion.starts_on > promotion.ends_on) {
    wrong.push('วันเริ่มต้องไม่หลังวันสิ้นสุด');
  }
  if ((promotion.hours_from === null) !== (promotion.hours_to === null)) {
    wrong.push('ใส่เวลาเริ่มและเวลาจบให้ครบ หรือเว้นว่างทั้งคู่');
  } else if (promotion.hours_from !== null && promotion.hours_to !== null) {
    if (!TIME.test(promotion.hours_from) || !TIME.test(promotion.hours_to)) {
      wrong.push('เวลาต้องเป็นแบบ 14:00');
    } else if (promotion.hours_from >= promotion.hours_to) {
      wrong.push('เวลาเริ่มต้องก่อนเวลาจบ');
    }
  }
  if (promotion.weekdays.some((day) => !(Number.isInteger(day) && day >= 0 && day <= 6))) {
    wrong.push('วันในสัปดาห์ไม่ถูกต้อง');
  }
  return wrong;
}

export async function savePromotion(
  promotion: Promotion,
  db: RuduPosDB = defaultDb,
): Promise<void> {
  const wrong = promotionProblems(promotion);
  if (wrong.length > 0) throw new CatalogError(wrong);
  await db.promotion.put({ ...promotion, name_th: promotion.name_th.trim() });
}

/** A blank promotion to start the editor from: ฿10 off any drink, every day, off by default. */
export function blankPromotion(sortOrder: number): Promotion {
  return {
    id: newId(),
    name_th: '',
    kind: 'AMOUNT_OFF',
    amount: 1_000,
    percent: 10,
    buy_qty: 2,
    free_qty: 1,
    variant_ids: [],
    activation: 'AUTO',
    manual_on: false,
    starts_on: null,
    ends_on: null,
    weekdays: [],
    hours_from: null,
    hours_to: null,
    stacks_with_two_cup: true,
    order_types: [],
    is_active: true,
    sort_order: sortOrder,
    synced_at: null,
  };
}
