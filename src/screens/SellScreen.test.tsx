/**
 * The sell screen, driven the way the operator drives it.
 *
 * These run against the real singleton database, because the thing worth
 * testing is that a tap reaches IndexedDB and comes back through useLiveQuery
 * — a mocked store would prove nothing about that path.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SellScreen from './SellScreen.tsx';
import { db } from '../db/database.ts';
import { ensureSeeded } from '../db/seed.ts';
import { ensureDeviceId } from '../db/device.ts';
import { clearCart, loadCart } from '../db/cart-repo.ts';
import { productionMovement } from '../domain/stock.ts';
import type { CashSession, ComponentBatch } from '../db/types.ts';
import { enabledButton } from '../test/helpers.ts';

/** The day these tests trade in. The sell screen is only ever shown inside one. */
const SESSION: CashSession = {
  id: 'SESSION_TEST',
  opened_at: new Date().toISOString(),
  closed_at: null,
  operator_id: 'เจ้าของ',
  opening_float: 150_000,
  expected_cash: null,
  counted_cash: null,
  variance: null,
  note: null,
  synced_at: null,
};

function batch(componentId: string, qty: number, state: ComponentBatch['state'] = 'READY') {
  const madeAt = '2026-09-22T00:00:00.000Z';
  return {
    id: `B_${componentId}`,
    component_id: componentId,
    made_at: madeAt,
    qty_made: qty,
    state,
    ready_at: madeAt,
    expires_at: '2026-12-25T00:00:00.000Z',
    parent_batch_id: null,
    note: null,
    synced_at: null,
  } satisfies ComponentBatch;
}

beforeAll(async () => {
  await ensureSeeded(db);
  await ensureDeviceId(db);

  const batches = [
    batch('COMP_TEA_RED', 5000),
    batch('COMP_TEA_WHITE', 4000),
    batch('COMP_CONC_TAMARIND', 3000),
    batch('COMP_CONC_PEAR', 3000),
    batch('COMP_JELLY_CHRYS', 1000, 'CUT'),
    batch('COMP_JELLY_WHITE_GOJI', 1000, 'CUT'),
    batch('COMP_PEAR_FRESH', 420),
    batch('COMP_PEACH_GUM', 350, 'BLANCHED'),
    batch('COMP_BASIL_SEED', 250),
  ];
  await db.component_batch.bulkPut(batches);
  await db.stock_movement.bulkPut(batches.map((entry) => productionMovement(entry, entry.made_at)));
});

beforeEach(async () => {
  await clearCart(db);
  await db.sale.clear();
  await db.sale_line.clear();
  await db.sale_line_mod.clear();
  await db.sale_line_discount.clear();
});

async function tamarindButton() {
  return screen.findByRole('button', { name: /มะขามแดง/ });
}

describe('the menu', () => {
  it('shows the short name, the price and the available cups with what limits them', async () => {
    render(<SellScreen session={SESSION} />);

    const tamarind = await tamarindButton();
    expect(tamarind).toHaveTextContent('มะขามแดง');
    expect(tamarind).toHaveTextContent('฿40');
    // 1000 g of jelly at 30 g a cup.
    expect(tamarind).toHaveTextContent('เหลือ 33 แก้ว');
    expect(tamarind).toHaveTextContent('เยลลี่เก๊กฮวย');
  });

  it('never renders the full marketing name on a button', async () => {
    render(<SellScreen session={SESSION} />);
    await tamarindButton();

    // สาลี่ขาวสมุนไพรจีน is 18 characters and would wrap to three lines.
    expect(screen.queryByText(/สาลี่ขาวสมุนไพรจีน/)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /สาลี่ขาว/ })).toHaveTextContent('สาลี่ขาว');
  });
});

describe('ringing a sale', () => {
  it('adds a cup on one tap, with no confirmation', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());

    await waitFor(async () => expect(await loadCart(db)).toHaveLength(1));
    expect(await screen.findByLabelText('เพิ่มจำนวน')).toBeInTheDocument();
  });

  it('increments on a second tap rather than adding a row', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const tamarind = await tamarindButton();
    await user.click(tamarind);
    await user.click(tamarind);

    await waitFor(async () => {
      const cart = await loadCart(db);
      expect(cart).toHaveLength(1);
      expect(cart[0]?.line.qty).toBe(2);
    });
  });

  it('steps a line down and removes it at zero', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await screen.findByLabelText('ลดจำนวน'));

    await waitFor(async () => expect(await loadCart(db)).toHaveLength(0));
    expect(await screen.findByText('ยังไม่มีรายการ')).toBeInTheDocument();
  });

  it('rings pear as ICED and switches to HOT in one tap on the line', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await screen.findByRole('button', { name: /สาลี่ขาว/ }));
    await waitFor(async () => {
      expect((await loadCart(db))[0]?.line.variant_id).toBe('VAR_PEAR_ICED');
    });

    await user.click(await screen.findByRole('button', { name: 'ร้อน' }));

    await waitFor(async () => {
      expect((await loadCart(db))[0]?.line.variant_id).toBe('VAR_PEAR_HOT');
    });
  });
});

describe('modifiers on the line', () => {
  it('hides peach gum on hot pear, where it is already in the recipe', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await screen.findByRole('button', { name: /สาลี่ขาว/ }));
    await user.click(await screen.findByLabelText('เพิ่มท็อปปิ้ง'));
    expect(await screen.findByRole('button', { name: /เพิ่มวุ้นยางท้อ/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ร้อน' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /เพิ่มวุ้นยางท้อ/ })).not.toBeInTheDocument();
    });
  });

  it('shows the salted plum advisory from the data, not from a string in the code', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await screen.findByLabelText('เพิ่มท็อปปิ้ง'));
    await user.click(await screen.findByRole('button', { name: /บ๊วยเค็ม/ }));

    const advisory = await screen.findByRole('alert');
    const seeded = await db.modifier.get('MOD_SALTED_PLUM');
    expect(seeded?.advisory_th).toBeTruthy();
    expect(advisory).toHaveTextContent(seeded!.advisory_th!);
  });
});

describe('sold out', () => {
  it('greys the drink but still takes the tap, and records the override', async () => {
    const user = userEvent.setup();
    // Empty the jelly: every tamarind component but that one is still there.
    await db.component_batch.update('B_COMP_JELLY_CHRYS', { state: 'DISCARDED' });

    render(<SellScreen session={SESSION} />);

    const tamarind = await screen.findByRole('button', { name: /มะขามแดง/ });
    await waitFor(() => expect(tamarind).toHaveTextContent('หมด'));

    await user.click(tamarind);
    expect(await screen.findByText('เลยจำนวนที่มี — ขายต่อ?')).toBeInTheDocument();
    // Nothing was added until the operator said so.
    expect(await loadCart(db)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'ขายต่อ' }));

    await waitFor(async () => {
      const cart = await loadCart(db);
      expect(cart).toHaveLength(1);
      expect(cart[0]?.line.sold_out_override).toBe(true);
    });

    await db.component_batch.update('B_COMP_JELLY_CHRYS', { state: 'CUT' });
  });
});

describe('the two-cup discount', () => {
  it('applies by itself when the cart qualifies — the operator never asks', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const tamarind = await tamarindButton();
    await user.click(tamarind);
    await user.click(tamarind);

    // 80 less 10 for the pair.
    expect(await screen.findByText('฿70')).toBeInTheDocument();
    expect(screen.getByText(/ส่วนลด 2 แก้ว/)).toBeInTheDocument();
  });

  it('gives nothing on a drink plus a bottle', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await screen.findByRole('button', { name: /ขวดมะขาม 1L/ }));

    expect(await screen.findByText('฿139')).toBeInTheDocument();
    expect(screen.queryByText(/ส่วนลด 2 แก้ว/)).not.toBeInTheDocument();
  });
});

describe('giving a cup away', () => {
  it('requires a reason, and offers no way to zero a line without one', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await screen.findByLabelText('ลดราคา'));

    // Only the operator's own reasons are offered. The two promotions apply
    // themselves, and offering them by hand would let a forgotten one look
    // like a deliberate one.
    expect(screen.getByRole('button', { name: 'แลกแสตมป์' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'พนักงาน' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ส่วนลด 2 แก้ว' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'แลกแสตมป์' }));

    await waitFor(async () => {
      expect((await loadCart(db))[0]?.line.manual_discount_reason).toBe('LOYALTY_REDEEM');
    });
    expect(await screen.findByText(/ฟรี — แลกแสตมป์/)).toBeInTheDocument();
  });

  it('rings a loyalty cup at zero but still deducts its components', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await screen.findByLabelText('ลดราคา'));
    await user.click(screen.getByRole('button', { name: 'แลกแสตมป์' }));
    await waitFor(async () => {
      expect((await loadCart(db))[0]?.line.manual_discount_reason).toBe('LOYALTY_REDEEM');
    });

    await user.click(await enabledButton('เงินสด'));
    await user.click(await screen.findByRole('button', { name: 'พอดี' }));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    const sale = (await db.sale.toArray())[0]!;
    // Out of revenue, into COGS, and still one cup off the stock.
    expect(sale.total_net).toBe(0);
    expect(sale.total_cost).toBeGreaterThan(0);
    expect(
      (await db.stock_movement.where('reason').equals('SALE').toArray()).length,
    ).toBeGreaterThan(0);
  });
});

describe('paying cash', () => {
  it('completes on พอดี, with no change to read', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await enabledButton('เงินสด'));
    await user.click(await screen.findByRole('button', { name: 'พอดี' }));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    const sale = (await db.sale.toArray())[0]!;
    expect(sale.total_net).toBe(4000);
    expect(sale.cash_received).toBe(4000);
    expect(sale.cash_change).toBe(0);
    expect(sale.payment_method).toBe('CASH');
    expect(await loadCart(db)).toHaveLength(0);
  });

  it('shows the change in the largest type on the screen, and that is the confirm', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await enabledButton('เงินสด'));
    await user.click(await screen.findByRole('button', { name: '฿100' }));

    const confirm = await screen.findByRole('button', { name: /ทอน/ });
    expect(confirm).toHaveTextContent('฿60');

    await user.click(confirm);

    await waitFor(async () => expect(await db.sale.count()).toBe(1));
    expect((await db.sale.toArray())[0]?.cash_change).toBe(6000);
  });

  it('will not take a tender smaller than the bill', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await screen.findByRole('button', { name: /สาลี่ขาว/ }));
    await user.click(await enabledButton('เงินสด'));

    // 59 THB due: 40 and 50 cannot pay it.
    expect(await screen.findByRole('button', { name: '฿40' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '฿50' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '฿59' })).toBeEnabled();
  });

  it('writes the discount rows the day report reads', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const tamarind = await tamarindButton();
    await user.click(tamarind);
    await user.click(tamarind);
    await user.click(await enabledButton('เงินสด'));
    await user.click(await screen.findByRole('button', { name: 'พอดี' }));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    const discounts = await db.sale_line_discount.toArray();
    expect(discounts).toHaveLength(1);
    expect(discounts[0]).toMatchObject({ reason: 'PROMO_TWO_CUP', amount: 1000 });
    expect((await db.sale.toArray())[0]?.total_net).toBe(7000);
  });
});

describe('paying by PromptPay', () => {
  it('says plainly that the app checked nothing, and waits for the operator', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await enabledButton('QR'));

    expect(await screen.findByText(/ระบบไม่ได้ตรวจสอบการโอน/)).toBeInTheDocument();
    // Nothing is recorded until the operator says the money arrived.
    expect(await db.sale.count()).toBe(0);

    await user.click(screen.getByRole('button', { name: 'ลูกค้าจ่ายแล้ว' }));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));
    const sale = (await db.sale.toArray())[0]!;
    expect(sale.payment_method).toBe('PROMPTPAY');
    expect(sale.cash_received).toBeNull();
  });
});

describe('the receipt', () => {
  it('is never prompted for, and opens from the completed-sale toast', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await enabledButton('เงินสด'));
    await user.click(await screen.findByRole('button', { name: 'พอดี' }));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));
    // Nothing opened by itself.
    expect(screen.queryByRole('dialog', { name: 'ใบเสร็จ' })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'ดูใบเสร็จ' }));

    const receipt = await screen.findByRole('dialog', { name: 'ใบเสร็จ' });
    expect(within(receipt).getByText(/มะขามแดง/)).toBeInTheDocument();
    expect(within(receipt).getByText('สุทธิ')).toBeInTheDocument();
    // The shop is not VAT registered: no VAT line, anywhere.
    expect(receipt).not.toHaveTextContent(/VAT|ภาษีมูลค่าเพิ่ม/);
  });
});

describe('an empty cart', () => {
  it('cannot be paid for', async () => {
    render(<SellScreen session={SESSION} />);
    expect(await screen.findByRole('button', { name: 'เงินสด' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'QR' })).toBeDisabled();
  });
});

describe('crash safety', () => {
  /** The closest jsdom gets to a hard reload: everything React held is gone. */
  async function reload() {
    cleanup();
    render(<SellScreen session={SESSION} />);
    await screen.findByRole('button', { name: /มะขามแดง/ });
  }

  it('survives a reload with an empty cart', async () => {
    render(<SellScreen session={SESSION} />);
    await reload();

    expect(screen.getByText('ยังไม่มีรายการ')).toBeInTheDocument();
    expect(await loadCart(db)).toHaveLength(0);
  });

  it('survives a reload with one line', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await tamarindButton());
    await waitFor(async () => expect((await loadCart(db))[0]?.line.qty).toBe(2));

    await reload();

    expect(await screen.findByText('2')).toBeInTheDocument();
    expect((await loadCart(db))[0]?.line.qty).toBe(2);
  });

  it('survives a reload with modifiers on the line', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await screen.findByLabelText('เพิ่มท็อปปิ้ง'));
    await user.click(await screen.findByRole('button', { name: /บ๊วยเค็ม/ }));
    await waitFor(async () => {
      expect((await loadCart(db))[0]?.modifierIds).toEqual(['MOD_SALTED_PLUM']);
    });

    await reload();

    // The modifier is still on the line, and so is its spoken advisory.
    expect(await screen.findByText(/บ๊วยเค็ม/)).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('ระวังสำลัก');
    expect((await loadCart(db))[0]?.modifierIds).toEqual(['MOD_SALTED_PLUM']);
  });

  it('survives a reload with a line given away', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await screen.findByLabelText('ลดราคา'));
    await user.click(screen.getByRole('button', { name: 'แลกแสตมป์' }));
    await waitFor(async () => {
      expect((await loadCart(db))[0]?.line.manual_discount_reason).toBe('LOYALTY_REDEEM');
    });

    await reload();

    expect(await screen.findByText(/ฟรี — แลกแสตมป์/)).toBeInTheDocument();
  });

  it('survives a reload on the payment screen, and does not resume a half tender', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await enabledButton('เงินสด'));
    await user.click(await screen.findByRole('button', { name: '฿100' }));
    expect(await screen.findByRole('button', { name: /ทอน/ })).toBeInTheDocument();

    await reload();

    // Back on the sell screen with the cart intact: a tender half entered
    // before the phone died is not something to carry forward.
    expect(screen.getByRole('button', { name: 'เงินสด' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /ทอน/ })).not.toBeInTheDocument();
    expect(await loadCart(db)).toHaveLength(1);
    expect(await db.sale.count()).toBe(0);
  });

  it('is empty again after a reload that follows a completed sale', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await enabledButton('เงินสด'));
    await user.click(await screen.findByRole('button', { name: 'พอดี' }));
    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    await reload();

    expect(screen.getByText('ยังไม่มีรายการ')).toBeInTheDocument();
  });
});

describe('the day’s sales', () => {
  it('lists them newest first with time, items, total and method', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await user.click(await tamarindButton());
    await user.click(await enabledButton('เงินสด'));
    await user.click(await screen.findByRole('button', { name: 'พอดี' }));
    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    await user.click(screen.getByLabelText('รายการขายวันนี้'));

    const list = await screen.findByRole('dialog', { name: 'รายการขายวันนี้' });
    expect(within(list).getByText('มะขามแดง')).toBeInTheDocument();
    expect(within(list).getByText('เงินสด')).toBeInTheDocument();
  });

  it('voids with a reason and puts the stock back', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    // What the tamarind button says before anything is sold.
    const before = (await tamarindButton()).textContent ?? '';

    await user.click(await tamarindButton());
    await user.click(await enabledButton('เงินสด'));
    await user.click(await screen.findByRole('button', { name: 'พอดี' }));
    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    await user.click(screen.getByLabelText('รายการขายวันนี้'));
    await user.click(await screen.findByRole('button', { name: /ยกเลิกบิล/ }));

    // A void cannot happen without a reason being chosen.
    expect(await screen.findByText('ยกเลิกเพราะอะไร?')).toBeInTheDocument();
    expect(await db.sale.get((await db.sale.toArray())[0]!.id)).toMatchObject({
      is_voided: false,
    });

    await user.click(screen.getByRole('button', { name: 'ลูกค้าเปลี่ยนใจ' }));

    await waitFor(async () => {
      expect((await db.sale.toArray())[0]?.is_voided).toBe(true);
    });

    expect(await screen.findByText(/ยกเลิกแล้ว — ลูกค้าเปลี่ยนใจ/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'กลับไปขาย' }));

    // Available cups is back where it started, and so is the day's revenue.
    await waitFor(async () => {
      expect((await tamarindButton()).textContent).toBe(before);
    });
    const movements = await db.stock_movement.where('reason').equals('VOID_REVERSAL').toArray();
    expect(movements.length).toBeGreaterThan(0);
  });
});

describe('today, live', () => {
  const header = () => screen.getByLabelText('รายการขายวันนี้');
  const cupsLeft = async () =>
    Number(/เหลือ (\d+) แก้ว/.exec((await tamarindButton()).textContent ?? '')?.[1]);

  async function pay(method: 'เงินสด' | 'QR') {
    const user = userEvent.setup();
    await user.click(await tamarindButton());
    await user.click(await enabledButton(method));
    if (method === 'เงินสด') {
      await user.click(await screen.findByRole('button', { name: 'พอดี' }));
    } else {
      await user.click(await screen.findByRole('button', { name: 'ลูกค้าจ่ายแล้ว' }));
    }
  }

  it('moves cups, revenue, the drawer and available cups with every sale and void', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await waitFor(() => expect(header()).toHaveTextContent('ลิ้นชัก ฿1,500'));
    expect(header()).toHaveTextContent('0 แก้ว');
    const before = await cupsLeft();

    // Cash: into the drawer.
    await pay('เงินสด');
    await waitFor(() => {
      expect(header()).toHaveTextContent('ลิ้นชัก ฿1,540');
      expect(header()).toHaveTextContent('1 แก้ว');
      expect(header()).toHaveTextContent('฿40');
    });
    await waitFor(async () => expect(await cupsLeft()).toBe(before - 1));

    // QR: the takings move, the drawer does not.
    await pay('QR');
    await waitFor(() => {
      expect(header()).toHaveTextContent('2 แก้ว');
      expect(header()).toHaveTextContent('฿80');
      expect(header()).toHaveTextContent('ลิ้นชัก ฿1,540');
    });

    // Void the cash sale: all of it comes back.
    await user.click(header());
    const list = await screen.findByRole('dialog', { name: 'รายการขายวันนี้' });
    const buttons = within(list).getAllByRole('button', { name: /ยกเลิกบิล/ });
    await user.click(buttons[buttons.length - 1]!); // oldest: the cash sale
    await user.click(within(list).getByRole('button', { name: 'กดผิด' }));
    await user.click(within(list).getByRole('button', { name: 'กลับไปขาย' }));

    await waitFor(() => {
      expect(header()).toHaveTextContent('ลิ้นชัก ฿1,500');
      expect(header()).toHaveTextContent('1 แก้ว');
    });
    await waitFor(async () => expect(await cupsLeft()).toBe(before - 1));
  });

  it('marks breakeven: cups against ten, then past it once gross profit covers the day', async () => {
    const fixed = await db.setting.get('fixed_cost_per_day');
    render(<SellScreen session={SESSION} />);
    await waitFor(() => expect(header()).toHaveTextContent('คุ้มทุน 0/10'));

    // A day whose fixed cost one cup covers.
    await db.setting.put({ key: 'fixed_cost_per_day', value: 1_000, synced_at: null });
    try {
      await pay('เงินสด');
      await waitFor(() => expect(header()).toHaveTextContent('ผ่านจุดคุ้มทุน'));

      const user = userEvent.setup();
      await user.click(header());
      const list = await screen.findByRole('dialog', { name: 'รายการขายวันนี้' });
      expect(within(list).getByText(/กำไรขั้นต้น .* จาก ฿10/)).toBeInTheDocument();
    } finally {
      await db.setting.put(fixed!);
    }
  });
});
