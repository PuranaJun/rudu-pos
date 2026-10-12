/**
 * The PromptPay QR, with the amount already in it (CLAUDE.md §4).
 *
 * An EMVCo merchant-presented payload in the Bank of Thailand's PromptPay
 * profile — the same text every Thai banking app reads. It is built here,
 * offline, from the shop's PromptPay ID and the bill: the customer scans and
 * their app opens with the right amount and nothing to type.
 *
 * It verifies nothing. No gateway, no callback, nothing polled: the operator
 * still looks at the customer's phone and confirms by hand.
 */
import type { Satang } from '../lib/money.ts';

export type PromptPayIdKind = 'PHONE' | 'TAX_ID' | 'EWALLET';

export interface PromptPayId {
  /** Digits only. */
  digits: string;
  kind: PromptPayIdKind;
}

/**
 * What the owner typed, if it is a PromptPay ID: a Thai mobile number
 * (10 digits from 0), a national ID or tax ID (13), or an e-wallet ID (15).
 * Dashes and spaces are fine; anything else is not an ID.
 */
export function parsePromptPayId(input: string): PromptPayId | null {
  if (/[^0-9\s-]/.test(input)) return null;
  const digits = input.replace(/[^0-9]/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return { digits, kind: 'PHONE' };
  if (digits.length === 13) return { digits, kind: 'TAX_ID' };
  if (digits.length === 15) return { digits, kind: 'EWALLET' };
  return null;
}

/** "•••• 4455" — enough for the operator to see it is the shop's account. */
export function maskPromptPayId(id: PromptPayId): string {
  return `•••• ${id.digits.slice(-4)}`;
}

const GUID_PROMPTPAY = 'A000000677010111';
const SUB_ID: Record<PromptPayIdKind, string> = { PHONE: '01', TAX_ID: '02', EWALLET: '03' };

/**
 * The payload. With an amount it is a one-time ("dynamic", 12) code for that
 * bill; with none, or nothing due, the reusable ("static", 11) code the
 * printed QR carries.
 */
export function promptPayPayload(id: PromptPayId, amount: Satang | null): string {
  const withAmount = amount !== null && amount > 0;
  // A phone number goes in as 0066 + the number without its leading 0.
  const target = id.kind === 'PHONE' ? `0066${id.digits.slice(1)}` : id.digits;

  const body = [
    field('00', '01'),
    field('01', withAmount ? '12' : '11'),
    field('29', field('00', GUID_PROMPTPAY) + field(SUB_ID[id.kind], target)),
    field('58', 'TH'),
    field('53', '764'),
    withAmount ? field('54', (amount / 100).toFixed(2)) : '',
  ].join('');

  const signed = `${body}6304`;
  return signed + crc16(signed);
}

function field(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, start 0xFFFF), as EMVCo specifies. Four hex digits. */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
