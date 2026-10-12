/** A receipt and a stand-in canvas, shared by the receipt picture's tests. */
import type { Receipt } from '../db/sale-repo.ts';

export const RECEIPT: Receipt = {
  saleId: 'SALE_1',
  orderNo: 12,
  orderType: 'DINE_IN',
  createdAt: '2026-10-12T03:15:00.000Z',
  brandingLineTh: 'ชาต้มเอง วันต่อวัน',
  lines: [
    {
      name: 'มะขามแดง',
      qty: 2,
      unitPrice: 4_000,
      net: 7_000,
      modifiers: ['หวานน้อย'],
      discounts: [{ label: 'PROMO_TWO_CUP', amount: 1_000 }],
    },
  ],
  totalGross: 8_000,
  totalDiscount: 1_000,
  totalNet: 7_000,
  paymentMethod: 'CASH',
  cashReceived: 10_000,
  cashChange: 3_000,
};

/** Records every word drawn; every character is 12px wide at any size. */
export function fakeCanvas() {
  const drawn: string[] = [];
  const ctx = {
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    scale: () => {},
    fillRect: () => {},
    fillText: (text: string) => drawn.push(text),
    measureText: (text: string) => ({ width: [...text].length * 12 }),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (done: (blob: Blob | null) => void) => done(new Blob(['png'], { type: 'image/png' })),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx, drawn };
}
