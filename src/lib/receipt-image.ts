/**
 * A receipt as a picture, for the customer who wants it in LINE rather than
 * on the operator's screen (CLAUDE.md §5: offered, never prompted).
 *
 * Drawn on a canvas, offline, in the app's own font — the phone's Thai system
 * font — so it looks like the receipt on the screen. No VAT line and no tax
 * arithmetic: the shop is not VAT registered, and the price is the price.
 */
import { formatTHB } from './money.ts';
import { bangkokDate, formatBangkok } from './datetime.ts';
import { DISCOUNT_REASON_TH } from '../domain/promotions.ts';
import { ORDER_TYPE_TH } from '../domain/queue.ts';
import type { DiscountReason } from '../db/types.ts';
import type { Receipt } from '../db/sale-repo.ts';

export const SHOP_NAME_TH = 'ฤดูชา';

export type ReceiptRow =
  | { kind: 'text'; text: string; size: number; bold?: boolean; align?: 'left' | 'center' }
  | { kind: 'pair'; left: string; right: string; size: number; bold?: boolean }
  | { kind: 'banner'; text: string }
  | { kind: 'rule' }
  | { kind: 'gap'; height: number };

const methodTh = (receipt: Receipt) => (receipt.paymentMethod === 'CASH' ? 'เงินสด' : 'พร้อมเพย์');

/** What the picture says, top to bottom. Pure: the words are tested, the pixels are not. */
export function receiptRows(receipt: Receipt, voidReason: string | null = null): ReceiptRow[] {
  const rows: ReceiptRow[] = [];

  // A voided bill never travels as if it stood.
  if (voidReason !== null) rows.push({ kind: 'banner', text: `บิลนี้ยกเลิกแล้ว — ${voidReason}` });

  rows.push({ kind: 'text', text: SHOP_NAME_TH, size: 40, bold: true, align: 'center' });
  if (receipt.brandingLineTh) {
    rows.push({ kind: 'text', text: receipt.brandingLineTh, size: 22, align: 'center' });
  }
  rows.push(
    { kind: 'gap', height: 8 },
    { kind: 'text', text: `คิว ${receipt.orderNo}`, size: 60, bold: true, align: 'center' },
    { kind: 'text', text: ORDER_TYPE_TH[receipt.orderType], size: 26, bold: true, align: 'center' },
    { kind: 'text', text: formatBangkok(receipt.createdAt), size: 22, align: 'center' },
    { kind: 'rule' },
  );

  receipt.lines.forEach((line, index) => {
    // Air between drinks, so a discount reads as its own drink's.
    if (index > 0) rows.push({ kind: 'gap', height: 10 });
    rows.push({
      kind: 'pair',
      left: `${line.name} × ${line.qty}`,
      // Full price on the line, its discounts under it: line − discounts =
      // what was paid, adding up the same way as รวม − ส่วนลด = สุทธิ.
      right: formatTHB(line.unitPrice * line.qty),
      size: 28,
      bold: true,
    });
    if (line.modifiers.length > 0) {
      rows.push({ kind: 'text', text: line.modifiers.join(' · '), size: 22 });
    }
    for (const discount of line.discounts) {
      rows.push({
        kind: 'pair',
        left: DISCOUNT_REASON_TH[discount.label as DiscountReason] ?? discount.label,
        right: `−${formatTHB(discount.amount)}`,
        size: 22,
      });
    }
  });

  rows.push(
    { kind: 'rule' },
    { kind: 'pair', left: 'รวม', right: formatTHB(receipt.totalGross), size: 26 },
  );
  if (receipt.totalDiscount > 0) {
    rows.push({
      kind: 'pair',
      left: 'ส่วนลด',
      right: `−${formatTHB(receipt.totalDiscount)}`,
      size: 26,
    });
  }
  rows.push(
    { kind: 'pair', left: 'สุทธิ', right: formatTHB(receipt.totalNet), size: 36, bold: true },
    { kind: 'pair', left: 'ชำระโดย', right: methodTh(receipt), size: 26 },
  );
  if (receipt.cashReceived !== null) {
    rows.push(
      { kind: 'pair', left: 'รับเงิน', right: formatTHB(receipt.cashReceived), size: 26 },
      { kind: 'pair', left: 'เงินทอน', right: formatTHB(receipt.cashChange ?? 0), size: 26 },
    );
  }
  return rows;
}

/** `rudu-receipt-2026-10-12-q12.png`, dated in Bangkok. */
export function receiptFilename(receipt: Receipt): string {
  return `rudu-receipt-${bangkokDate(receipt.createdAt)}-q${receipt.orderNo}.png`;
}

const WIDTH = 480;
const PAD = 32;
/** Drawn at twice the size, so it stays sharp when zoomed in LINE. */
const SCALE = 2;
const INK = '#1a1512';
const EXPIRED = '#a1170c';

/** The picture, as a PNG file ready for the share sheet. */
export async function receiptImageFile(
  receipt: Receipt,
  voidReason: string | null = null,
  canvas: HTMLCanvasElement = document.createElement('canvas'),
): Promise<File> {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');

  const family =
    (typeof document !== 'undefined' && getComputedStyle(document.body).fontFamily) || 'sans-serif';
  const font = (size: number, bold = false) => `${bold ? 'bold ' : ''}${size}px ${family}`;
  const rows = receiptRows(receipt, voidReason);
  const inner = WIDTH - PAD * 2;

  // Measured first, at the real fonts, so the canvas is exactly as tall as the
  // receipt — setting its height afterwards would wipe whatever was drawn.
  const laidOut = rows.map((row) => layout(ctx, row, inner, font));
  const height = PAD * 2 + laidOut.reduce((total, item) => total + item.height, 0);

  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.textBaseline = 'top';

  let y = PAD;
  for (const item of laidOut) {
    item.draw(y);
    y += item.height;
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('could not encode the receipt');
  return new File([blob], receiptFilename(receipt), { type: 'image/png' });

  function layout(
    context: CanvasRenderingContext2D,
    row: ReceiptRow,
    width: number,
    fontOf: typeof font,
  ): { height: number; draw: (top: number) => void } {
    switch (row.kind) {
      case 'gap':
        return { height: row.height, draw: () => {} };
      case 'rule':
        return {
          height: 24,
          draw: (top) => {
            context.fillStyle = INK;
            context.fillRect(PAD, top + 11, width, 2);
          },
        };
      case 'banner': {
        context.font = fontOf(24, true);
        const lines = wrap(context, row.text, width - 24);
        const lineHeight = leading(24);
        return {
          height: lines.length * lineHeight + 24 + 12,
          draw: (top) => {
            context.fillStyle = EXPIRED;
            context.fillRect(PAD, top, width, lines.length * lineHeight + 24);
            context.fillStyle = '#ffffff';
            context.font = fontOf(24, true);
            context.textAlign = 'left';
            lines.forEach((line, i) => context.fillText(line, PAD + 12, top + 12 + i * lineHeight));
          },
        };
      }
      case 'text': {
        context.font = fontOf(row.size, row.bold);
        const lines = wrap(context, row.text, width);
        const lineHeight = leading(row.size);
        return {
          height: lines.length * lineHeight,
          draw: (top) => {
            context.fillStyle = INK;
            context.font = fontOf(row.size, row.bold);
            context.textAlign = row.align === 'center' ? 'center' : 'left';
            const x = row.align === 'center' ? WIDTH / 2 : PAD;
            lines.forEach((line, i) => context.fillText(line, x, top + i * lineHeight));
          },
        };
      }
      case 'pair': {
        context.font = fontOf(row.size, row.bold);
        const rightWidth = context.measureText(row.right).width;
        const lines = wrap(context, row.left, Math.max(width / 3, width - rightWidth - 16));
        const lineHeight = leading(row.size);
        return {
          height: lines.length * lineHeight,
          draw: (top) => {
            context.fillStyle = INK;
            context.font = fontOf(row.size, row.bold);
            context.textAlign = 'left';
            lines.forEach((line, i) => context.fillText(line, PAD, top + i * lineHeight));
            context.textAlign = 'right';
            context.fillText(row.right, WIDTH - PAD, top);
          },
        };
      }
    }
  }
}

/** Thai leaves room above and below the line for its vowels and tone marks. */
function leading(size: number): number {
  return Math.round(size * 1.5);
}

/**
 * Break text to fit a width. Thai has no spaces between words, so the breaks
 * come from the browser's own Thai word segmenter, and a single word too long
 * for the line is cut by character rather than left to run off the edge.
 */
export function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words =
    typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map((s) => s.segment)
      : [...text];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current + word;
    if (current === '' || ctx.measureText(candidate).width <= width) {
      current = candidate;
      continue;
    }
    lines.push(current.trimEnd());
    current = word.trimStart();
    // A word wider than the whole line: cut it where it overflows.
    while (current.length > 1 && ctx.measureText(current).width > width) {
      let cut = current.length - 1;
      while (cut > 1 && ctx.measureText(current.slice(0, cut)).width > width) cut--;
      lines.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  if (current !== '' || lines.length === 0) lines.push(current);
  return lines;
}
