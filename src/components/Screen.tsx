import type { ReactNode } from 'react';
import { Button } from './Button.tsx';

/**
 * The chrome every screen shares, so the operator always knows two things
 * without reading: where am I (the title, top left) and how do I get out
 * (bottom left, and the button says where it goes).
 *
 * The one thing to do on a screen is bottom right, in thumb reach. Nothing
 * that leaves a screen lives anywhere else.
 */

/** Where the back button goes, in words: "กลับไปขาย", never just "กลับ". */
export interface BackTo {
  label: string;
  onClick: () => void;
}

export interface FooterAction {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean | undefined;
  variant?: 'primary' | 'danger' | 'qr' | undefined;
  size?: 'lg' | 'xl' | undefined;
}

export function Screen({
  title,
  label,
  subtitle,
  aside,
  below,
  children,
}: {
  title: ReactNode;
  /** The dialog's name, when the title is not plain text. */
  label?: string | undefined;
  subtitle?: ReactNode;
  /** Right of the title: a total, a status. Never a way out. */
  aside?: ReactNode;
  /** Under the title, still in the header: tabs, a banner. */
  below?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      className="safe-x text-ink fixed inset-0 z-30 flex flex-col bg-white"
    >
      <header className="safe-top border-line border-b px-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl leading-tight font-bold">{title}</h1>
            {subtitle ? <p className="text-ink-soft text-lg font-bold">{subtitle}</p> : null}
          </div>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </div>
        {below}
      </header>
      {children}
    </div>
  );
}

/** The part that scrolls. */
export function ScreenBody({
  children,
  className = '',
  flush = false,
}: {
  children: ReactNode;
  className?: string | undefined;
  /** No side padding, for a full-width banner; the content pads itself. */
  flush?: boolean | undefined;
}) {
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto pb-4 ${flush ? '' : 'px-4'} ${className}`}>
      {children}
    </div>
  );
}

/**
 * Bottom of the screen: notices first (a total, an error), then back on the
 * left and the one primary action on the right.
 */
export function ScreenFooter({
  back,
  primary,
  children,
}: {
  back?: BackTo | undefined;
  primary?: FooterAction | undefined;
  children?: ReactNode;
}) {
  return (
    <footer className="safe-bottom border-line border-t px-4 pt-3">
      {children}
      {back || primary ? (
        <div className="flex gap-3">
          {back ? (
            <Button
              variant="secondary"
              size={primary ? 'md' : 'lg'}
              onClick={back.onClick}
              className={primary ? 'flex-1 py-1' : 'w-full py-3'}
            >
              {back.label}
            </Button>
          ) : null}
          {primary ? (
            <Button
              variant={primary.variant ?? 'primary'}
              size={primary.size ?? 'lg'}
              disabled={primary.disabled}
              onClick={primary.onClick}
              className="flex-[1.4]"
            >
              {primary.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </footer>
  );
}
