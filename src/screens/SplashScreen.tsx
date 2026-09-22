import { formatBangkok } from '../lib/format.ts';

/**
 * Placeholder screen. Its only job is to prove a deploy landed on the phone:
 * the build timestamp changes on every build.
 */
export default function SplashScreen() {
  return (
    <div className="safe-x flex h-full flex-col bg-paper text-ink">
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-5xl font-bold tracking-tight">ฤดูชา POS</h1>
        <p className="text-lg font-semibold text-ink-soft">ชาต้มเอง วันต่อวัน</p>
      </main>

      <footer className="safe-bottom safe-x border-t border-line px-6 pt-3 text-center">
        <p className="text-base font-semibold text-ink-soft">
          build <time dateTime={__BUILD_TIME__}>{formatBangkok(__BUILD_TIME__)}</time>
        </p>
      </footer>
    </div>
  );
}
