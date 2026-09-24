/**
 * Settings, read as a typed object.
 *
 * Everything here is a row the owner can edit. The fallbacks exist only so a
 * half-migrated database still opens; they are not the source of truth and
 * nothing should ever depend on them being right.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type { Satang } from '../lib/money.ts';
import type { PromotionSettings } from '../domain/promotions.ts';

export interface PosSettings extends PromotionSettings {
  openingFloat: Satang;
  fixedCostPerDay: Satang;
  breakevenCups: number;
  /** Tender denominations, in satang, in the order they are shown. */
  quickTender: Satang[];
  loyaltyStampsRequired: number;
  brandingLineTh: string;
  /** A data URL the operator uploads once. The printed QR is the real one. */
  promptPayQrImage: string | null;
  vatRegistered: boolean;
  operators: string[];
  /** One-tap choices when voiding. A void always carries one. */
  voidReasons: string[];
}

const FALLBACK: PosSettings = {
  openingFloat: 150_000,
  fixedCostPerDay: 37_000,
  breakevenCups: 10,
  quickTender: [4000, 5000, 5900, 10_000, 50_000, 100_000],
  twoCupEnabled: true,
  twoCupAmount: 1000,
  rainyDayEnabled: false,
  rainyDayAmount: 500,
  rainyDayVariantId: null,
  loyaltyStampsRequired: 10,
  brandingLineTh: '',
  promptPayQrImage: null,
  vatRegistered: false,
  operators: [],
  voidReasons: ['ยกเลิก'],
};

export async function loadSettings(db: RuduPosDB = defaultDb): Promise<PosSettings> {
  const rows = await db.setting.toArray();
  const values = new Map(rows.map((row) => [row.key, row.value]));

  const num = (key: string, fallback: number) => {
    const value = values.get(key);
    return typeof value === 'number' ? value : fallback;
  };
  const bool = (key: string, fallback: boolean) => {
    const value = values.get(key);
    return typeof value === 'boolean' ? value : fallback;
  };
  const str = (key: string, fallback: string | null) => {
    const value = values.get(key);
    return typeof value === 'string' ? value : fallback;
  };

  const tender = values.get('quick_tender');

  return {
    openingFloat: num('opening_float', FALLBACK.openingFloat),
    fixedCostPerDay: num('fixed_cost_per_day', FALLBACK.fixedCostPerDay),
    breakevenCups: num('breakeven_cups', FALLBACK.breakevenCups),
    quickTender: Array.isArray(tender)
      ? tender.filter((value): value is number => typeof value === 'number')
      : FALLBACK.quickTender,
    twoCupEnabled: bool('promo_two_cup_enabled', FALLBACK.twoCupEnabled),
    twoCupAmount: num('promo_two_cup_amount', FALLBACK.twoCupAmount),
    rainyDayEnabled: bool('promo_rainy_day_enabled', FALLBACK.rainyDayEnabled),
    rainyDayAmount: num('promo_rainy_day_amount', FALLBACK.rainyDayAmount),
    rainyDayVariantId: str('promo_rainy_day_variant_id', FALLBACK.rainyDayVariantId),
    loyaltyStampsRequired: num('loyalty_stamps_required', FALLBACK.loyaltyStampsRequired),
    brandingLineTh: str('branding_line_th', '') ?? '',
    promptPayQrImage: str('promptpay_qr_image', null),
    vatRegistered: bool('vat_registered', FALLBACK.vatRegistered),
    operators: (() => {
      const value = values.get('operators');
      return Array.isArray(value) ? value.map(String) : FALLBACK.operators;
    })(),
    voidReasons: (() => {
      const value = values.get('void_reasons');
      return Array.isArray(value) && value.length > 0 ? value.map(String) : FALLBACK.voidReasons;
    })(),
  };
}
