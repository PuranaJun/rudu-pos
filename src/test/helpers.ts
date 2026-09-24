import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * A button, once it can be pressed.
 *
 * The pay buttons are disabled until the cart shows a line, and the cart is a
 * live query: a click that lands before it repaints hits a disabled button
 * and does nothing. On a phone the gap is a few milliseconds; under a full,
 * parallel test run it can be most of a second.
 */
export async function enabledButton(name: string | RegExp): Promise<HTMLElement> {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}
