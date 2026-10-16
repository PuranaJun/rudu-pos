import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';
import type { BackTo } from '../components/Screen.tsx';

/** A back button for a screen rendered on its own, going nowhere. */
export const BACK: BackTo = { label: 'กลับไปขาย', onClick: () => {} };

/**
 * A button, once it can be pressed.
 *
 * The pay buttons are not there until the basket shows a line, and are off
 * while a sale is being written; the basket is a live query, so a click that
 * lands before it repaints finds nothing to press, or presses nothing. On a phone the gap is a few milliseconds; under a full,
 * parallel test run it can be most of a second.
 */
export async function enabledButton(name: string | RegExp): Promise<HTMLElement> {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

/** The drink page's own button: ใส่ตะกร้า, บันทึก on a line, ขายต่อ past หมด. */
export const ADD_BUTTON = /^(ใส่ตะกร้า|บันทึก|ขายต่อ) ฿/;

/** Tap a drink on the menu; its page opens. Returns the page. */
export async function openDrink(user: UserEvent, drink: string | RegExp): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: drink }));
  const add = await screen.findByRole('button', { name: ADD_BUTTON });
  return add.closest<HTMLElement>('[role="dialog"]')!;
}

/** The page's ใส่ตะกร้า (or บันทึก, or ขายต่อ), and back to the sell screen. */
export async function putInBasket(user: UserEvent): Promise<void> {
  const page = (await screen.findByRole('button', { name: ADD_BUTTON })).closest<HTMLElement>(
    '[role="dialog"]',
  )!;
  await user.click(within(page).getByRole('button', { name: ADD_BUTTON }));
  await waitFor(() => expect(page).not.toBeInTheDocument());
}

/** One plain cup in the basket: the drink, then ใส่ตะกร้า. */
export async function addCup(user: UserEvent, drink: string | RegExp): Promise<void> {
  await openDrink(user, drink);
  await putInBasket(user);
}
