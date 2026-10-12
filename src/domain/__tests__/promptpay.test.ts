/**
 * The PromptPay payload, checked character for character against
 * promptpay-qr 0.5.0 — the reference implementation Thai developers have
 * used for years — so a banking app reads it the way it reads theirs.
 */
import { describe, expect, it } from 'vitest';
import { crc16, maskPromptPayId, parsePromptPayId, promptPayPayload } from '../promptpay.ts';

const PHONE = parsePromptPayId('0812345678')!;

describe('promptPayPayload', () => {
  it('puts the amount in a one-time code', () => {
    expect(promptPayPayload(PHONE, 5_900)).toBe(
      '00020101021229370016A000000677010111011300668123456785802TH5303764540559.006304C041',
    );
    expect(promptPayPayload(PHONE, 422)).toBe(
      '00020101021229370016A000000677010111011300668123456785802TH530376454044.2263045D49',
    );
  });

  it('gives the reusable code when there is nothing to charge', () => {
    const fixed = '00020101021129370016A000000677010111011300668123456785802TH530376463045D82';
    expect(promptPayPayload(PHONE, null)).toBe(fixed);
    expect(promptPayPayload(PHONE, 0)).toBe(fixed);
  });

  it('reads a phone number however it was typed', () => {
    expect(promptPayPayload(parsePromptPayId('081-234-5678')!, 5_400)).toBe(
      '00020101021229370016A000000677010111011300668123456785802TH5303764540554.0063049625',
    );
  });

  it('takes a national ID or tax ID, and an e-wallet ID', () => {
    expect(promptPayPayload(parsePromptPayId('1234567890123')!, 9_900)).toBe(
      '00020101021229370016A000000677010111021312345678901235802TH5303764540599.0063045135',
    );
    expect(promptPayPayload(parsePromptPayId('123456789012345')!, 5_900)).toBe(
      '00020101021229390016A00000067701011103151234567890123455802TH5303764540559.006304E835',
    );
  });
});

describe('parsePromptPayId', () => {
  it('knows the three kinds by length', () => {
    expect(parsePromptPayId('081 234 5678')).toEqual({ digits: '0812345678', kind: 'PHONE' });
    expect(parsePromptPayId('1-2345-67890-12-3')?.kind).toBe('TAX_ID');
    expect(parsePromptPayId('123456789012345')?.kind).toBe('EWALLET');
  });

  it('refuses anything that is not one', () => {
    for (const input of [
      '',
      '081234567',
      '8123456789',
      '08123456789',
      '081234567x',
      '+66812345678',
    ]) {
      expect(parsePromptPayId(input)).toBeNull();
    }
  });
});

describe('the rest', () => {
  it('shows only the last four digits', () => {
    expect(maskPromptPayId(PHONE)).toBe('•••• 5678');
  });

  it('computes CRC-16/CCITT-FALSE', () => {
    // The standard check value for this CRC.
    expect(crc16('123456789')).toBe('29B1');
  });
});
