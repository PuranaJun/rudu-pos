import { useState } from 'react';
import { Button } from '../components/Button.tsx';
import SyncPanel from '../components/SyncPanel.tsx';
import BackupCard from '../components/BackupCard.tsx';
import { Screen, ScreenBody, ScreenFooter } from '../components/Screen.tsx';
import { formatTHB } from '../lib/money.ts';
import { bangkokTime, formatBangkok } from '../lib/datetime.ts';
import { defaultVariantOf } from '../domain/cart.ts';
import { availableCups } from '../domain/stock.ts';
import { packagingWarnings } from '../domain/packaging.ts';
import { breakeven, EMPTY_DAY_TOTALS } from '../domain/reporting.ts';
import { ORDER_TYPE_TH } from '../domain/queue.ts';
import {
  useCostCatalog,
  useExpectedCash,
  useOpenSession,
  usePackagingStock,
  useQueue,
  useSessionTotals,
  useSettings,
  useStockSnapshot,
  useSyncState,
  useTodaySales,
} from '../db/hooks.ts';
import { sessionBusinessDate } from '../db/session-repo.ts';
import { fetchChanges } from '../sync/sync-client.ts';
import { useNav } from '../nav/nav-store.ts';
import type { CashSession } from '../db/types.ts';

/**
 * Home on a view-only device (CLAUDE.md §8): the shop's day as the shop phone
 * last sent it — cups, takings, the drawer, what is running low, the bills —
 * the reports, and the backup file. Nothing here sells, voids or edits: this
 * device's copy is the cloud's, and only the shop phone writes.
 *
 * It refreshes when it is opened and on the button. Never on a timer.
 */
export default function ViewerHome() {
  const sync = useSyncState();
  const session = useOpenSession();
  const open = useNav((state) => state.open);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'SYNC' | 'BACKUP' | null>(null);
  const backHome = { label: 'กลับไปดูยอด', onClick: () => setPanel(null) };

  if (panel === 'SYNC') {
    return (
      <Screen title="ซิงค์ออนไลน์">
        <ScreenBody>
          <SyncPanel />
        </ScreenBody>
        <ScreenFooter back={backHome} />
      </Screen>
    );
  }

  if (panel === 'BACKUP') {
    // The owner's copy, saved off both phones and the cloud: the shop phone
    // would only download it where the staff can open it (CLAUDE.md §13).
    return (
      <Screen title="สำรองข้อมูล">
        <ScreenBody>
          <p className="mt-3 text-lg font-bold">
            ทุกอย่างของร้านเป็นไฟล์เดียว รวมต้นทุน — เก็บไว้ใน iCloud Drive หรือ Files
            อย่าส่งเข้ากลุ่ม LINE ที่พนักงานอยู่
          </p>
          <div className="mt-3">
            <BackupCard backLabel="กลับไปดูยอด" />
          </div>
        </ScreenBody>
        <ScreenFooter back={backHome} />
      </Screen>
    );
  }

  function refresh() {
    if (busy) return;
    setBusy(true);
    void fetchChanges().finally(() => setBusy(false));
  }

  return (
    <div className="safe-x text-ink flex h-full flex-col bg-white">
      <header className="safe-top border-line border-b px-4 pb-2">
        <h1 className="text-3xl font-bold">ดูยอดร้าน</h1>
        <p className="text-ink-soft text-lg font-bold tabular-nums">
          ดูอย่างเดียว · อัปเดต {sync?.lastFetched ? formatBangkok(sync.lastFetched) : '—'}
        </p>
        {sync?.error ? (
          <p role="alert" className="bg-today mt-1 rounded-lg px-2 text-lg font-bold">
            อัปเดตไม่สำเร็จ: {sync.error}
          </p>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {session === undefined ? null : session ? (
          <OpenDay session={session} />
        ) : (
          <p className="py-6 text-xl font-bold">ร้านปิดอยู่ — ดูวันที่ผ่านมาได้ที่ “รายงาน”</p>
        )}
      </main>

      <footer className="safe-bottom border-line flex flex-col gap-2 border-t px-4 pt-3">
        <Button variant="primary" size="lg" onClick={refresh} disabled={busy} className="w-full">
          {busy ? 'กำลังอัปเดต…' : 'อัปเดตตอนนี้'}
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => open('REPORTS')} className="flex-1">
            รายงาน
          </Button>
          <Button variant="secondary" onClick={() => setPanel('BACKUP')} className="flex-1">
            สำรอง
          </Button>
          <Button variant="secondary" onClick={() => setPanel('SYNC')} className="flex-1">
            ซิงค์
          </Button>
        </div>
      </footer>
    </div>
  );
}

function OpenDay({ session }: { session: CashSession }) {
  const catalog = useCostCatalog();
  const stock = useStockSnapshot();
  const settings = useSettings();
  const totals = useSessionTotals(session) ?? EMPTY_DAY_TOTALS;
  const drawer = useExpectedCash(session);
  const queue = useQueue(catalog, session);
  const packaging = usePackagingStock(catalog);
  const sales = useTodaySales(catalog, sessionBusinessDate(session));

  if (!catalog || !stock || !settings) return null;
  const even = breakeven(totals, settings.fixedCostPerDay, settings.breakevenCups);
  const warnings = packaging ? packagingWarnings(packaging) : [];
  const drinks = [...catalog.products.values()]
    .filter((product) => product.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);

  return (
    <>
      <p className="text-ink-soft pt-3 text-lg font-bold">
        เปิดร้าน {formatBangkok(session.opened_at)} · {session.operator_id}
      </p>
      <dl className="grid grid-cols-2 gap-3 pt-2">
        <Figure label="แก้ว" value={String(totals.units)} />
        <Figure label="ยอดขาย" value={formatTHB(totals.revenue)} />
        <Figure label="เงินในลิ้นชัก" value={drawer === undefined ? '—' : formatTHB(drawer)} />
        <Figure
          label="จุดคุ้มทุน"
          value={even.past ? 'ผ่านแล้ว' : `${even.cups}/${even.cupsTarget} แก้ว`}
        />
      </dl>

      {warnings.length > 0 ? (
        <p className="bg-today mt-3 rounded-xl px-3 py-2 text-lg font-bold">
          <span aria-hidden="true">⚠ </span>
          {warnings
            .map((w) =>
              w.level === 'OUT'
                ? `${w.item.name_th} หมด`
                : `${w.item.name_th} เหลือ ${w.remaining}`,
            )
            .join(' · ')}
        </p>
      ) : null}

      <section aria-label="เหลือขายได้" className="pt-5">
        <h2 className="border-line border-b pb-1 text-xl font-bold">เหลือขายได้</h2>
        <ul>
          {drinks.map((product) => {
            const variant = defaultVariantOf(catalog, product.id);
            if (!variant) return null;
            const { cups, limitingComponentId } = availableCups(catalog, stock, variant.id);
            const limiting = limitingComponentId
              ? catalog.components.get(limitingComponentId)?.name_th
              : null;
            return (
              <li key={product.id} className="flex justify-between gap-3 py-1 text-lg font-bold">
                <span>{product.name_short_th}</span>
                <span className="text-right tabular-nums">
                  {Number.isFinite(cups) ? `${cups} แก้ว` : '—'}
                  {Number.isFinite(cups) && limiting ? ` · ${limiting}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="บิลวันนี้" className="pt-5">
        <h2 className="border-line border-b pb-1 text-xl font-bold">
          บิลวันนี้ {queue ? `· คิวรอ ${queue.waiting.length}` : ''}
        </h2>
        {!sales || sales.length === 0 ? (
          <p className="text-ink-soft py-2 text-lg font-bold">ยังไม่มีบิล</p>
        ) : (
          <ul>
            {sales.map((sale) => (
              <li key={sale.id} className="border-line border-b py-2">
                <p className="flex justify-between gap-3 text-lg font-bold tabular-nums">
                  <span>
                    คิว {sale.orderNo} · {bangkokTime(sale.createdAt)}
                  </span>
                  <span className={sale.isVoided ? 'text-ink-soft line-through' : ''}>
                    {formatTHB(sale.totalNet)}
                  </span>
                </p>
                <p className={`text-base font-bold ${sale.isVoided ? 'line-through' : ''}`}>
                  {sale.items} · {ORDER_TYPE_TH[sale.orderType]} ·{' '}
                  {sale.paymentMethod === 'CASH' ? 'เงินสด' : 'พร้อมเพย์'}
                </p>
                {sale.isVoided ? (
                  <p className="text-base font-bold">ยกเลิกแล้ว — {sale.voidReason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-paper-sunk rounded-xl px-3 py-2">
      <dt className="text-base font-bold">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}
