/**
 * The receipt picture. jsdom has no canvas, so a stand-in records what would
 * be drawn: the words are what matter, and the words are checked.
 */
import { describe, expect, it } from 'vitest';
import { receiptFilename, receiptImageFile, receiptRows, wrap } from './receipt-image.ts';
import { fakeCanvas, RECEIPT } from '../test/receipt-fixtures.ts';

const words = (rows: ReturnType<typeof receiptRows>) =>
  rows.flatMap((row) =>
    row.kind === 'text' || row.kind === 'banner'
      ? [row.text]
      : row.kind === 'pair'
        ? [row.left, row.right]
        : [],
  );

describe('receiptRows', () => {
  it('calls the customer by number, says where they eat, and adds up', () => {
    const text = words(receiptRows(RECEIPT));
    expect(text.slice(0, 4)).toEqual(['ฤดูชา', 'ชาต้มเอง วันต่อวัน', 'คิว 12', 'ทานที่ร้าน']);
    expect(text).toEqual(
      expect.arrayContaining([
        'มะขามแดง × 2',
        '฿70',
        'หวานน้อย',
        'ส่วนลด 2 แก้ว',
        '−฿10',
        'สุทธิ',
        'เงินสด',
        'เงินทอน',
        '฿30',
      ]),
    );
  });

  it('never shows VAT', () => {
    expect(words(receiptRows(RECEIPT)).join(' ')).not.toMatch(/VAT|ภาษี/);
  });

  it('puts a voided bill’s reason above everything', () => {
    const rows = receiptRows(RECEIPT, 'ลูกค้าเปลี่ยนใจ');
    expect(rows[0]).toEqual({ kind: 'banner', text: 'บิลนี้ยกเลิกแล้ว — ลูกค้าเปลี่ยนใจ' });
  });

  it('leaves out the cash lines for PromptPay', () => {
    const text = words(
      receiptRows({ ...RECEIPT, paymentMethod: 'PROMPTPAY', cashReceived: null, cashChange: null }),
    );
    expect(text).toContain('พร้อมเพย์');
    expect(text).not.toContain('เงินทอน');
  });
});

describe('receiptImageFile', () => {
  it('draws every row and hands back a PNG named for the day and the queue number', async () => {
    const { canvas, drawn } = fakeCanvas();
    const file = await receiptImageFile(RECEIPT, null, canvas);

    expect(file.name).toBe('rudu-receipt-2026-10-12-q12.png');
    expect(file.type).toBe('image/png');
    expect(drawn).toEqual(expect.arrayContaining(['คิว 12', 'ทานที่ร้าน', 'มะขามแดง × 2', '฿70']));
    // Twice the size, so it stays sharp when zoomed in LINE.
    expect(canvas.width).toBe(960);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it('refuses rather than sharing a blank picture when there is no canvas', async () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    await expect(receiptImageFile(RECEIPT, null, canvas)).rejects.toThrow('canvas unavailable');
  });
});

describe('wrap', () => {
  const { ctx } = fakeCanvas();
  const measure = ctx as unknown as CanvasRenderingContext2D;

  it('keeps a short line whole', () => {
    expect(wrap(measure, 'หวานน้อย', 400)).toEqual(['หวานน้อย']);
  });

  it('breaks long Thai between words, and never past the width', () => {
    const lines = wrap(measure, 'หวานน้อย · ไม่ใส่น้ำแข็ง · เพิ่มเม็ดแมงลัก · ใส่ถุงกลับบ้าน', 120);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('').replace(/\s/g, '')).toBe(
      'หวานน้อย·ไม่ใส่น้ำแข็ง·เพิ่มเม็ดแมงลัก·ใส่ถุงกลับบ้าน',
    );
    for (const line of lines) expect([...line].length * 12).toBeLessThanOrEqual(120);
  });

  it('gives receipts filenames dated in Bangkok', () => {
    // 20:00 UTC on the 11th is already the 12th in Bangkok.
    expect(receiptFilename({ ...RECEIPT, createdAt: '2026-10-11T20:00:00.000Z' })).toBe(
      'rudu-receipt-2026-10-12-q12.png',
    );
  });
});
