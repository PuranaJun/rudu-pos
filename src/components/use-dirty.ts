import { useState } from 'react';

/**
 * Whether a form differs from what was last saved, and whether the last save
 * is still what is on screen.
 *
 * `values` is everything the form would save. It is compared as JSON, so
 * pass plain data: the text in the fields, not parsed numbers. Call
 * `markSaved` once a save has landed — from the save's own promise, never
 * from an effect.
 */
export function useDirty(values: unknown): {
  dirty: boolean;
  justSaved: boolean;
  markSaved: () => void;
} {
  const current = JSON.stringify(values);
  const [baseline, setBaseline] = useState(current);
  const [savedAs, setSavedAs] = useState<string | null>(null);

  return {
    dirty: current !== baseline,
    // "บันทึกแล้ว" only while nothing has been typed since.
    justSaved: savedAs === current,
    markSaved: () => {
      setBaseline(current);
      setSavedAs(current);
    },
  };
}
