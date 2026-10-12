import { useState } from 'react';
import { Button } from './Button.tsx';
import { TextField } from './form.tsx';
import { formatBangkok } from '../lib/datetime.ts';
import { shareText } from '../lib/share.ts';
import { db } from '../db/database.ts';
import { resetAndReseed } from '../db/seed.ts';
import { usePendingCount, useSyncState } from '../db/hooks.ts';
import { formatKey } from '../sync/key.ts';
import { pairLink } from '../sync/pairing.ts';
import {
  fetchChanges,
  joinWithKey,
  rotateKey,
  sendChanges,
  startAsShop,
  stopSync,
  type JoinResult,
  type SetupResult,
} from '../sync/sync-client.ts';

const SETUP_TH: Record<Exclude<SetupResult, 'ok'>, string> = {
  exists:
    'ร้านนี้เปิดซิงค์ไว้แล้วจากเครื่องอื่น — ถ้าเครื่องนี้มาแทนเครื่องเดิม ใส่รหัสร้านด้านล่างแล้วกด “ใช้แทนเครื่องร้านเดิม”',
  'no-database': 'ยังไม่ได้เชื่อมฐานข้อมูลใน Cloudflare — ทำตามขั้นตอนตั้งค่าครั้งแรกก่อน',
  'no-setup-code': 'ยังไม่ได้ตั้งรหัสตั้งค่า (SYNC_SETUP_CODE) ใน Cloudflare',
  'wrong-setup-code': 'รหัสตั้งค่าไม่ตรงกับที่ตั้งไว้ใน Cloudflare',
  offline: 'ต่ออินเทอร์เน็ตไม่ได้ ลองใหม่เมื่อมีสัญญาณ',
};
const JOIN_TH: Record<Exclude<JoinResult, 'ok'>, string> = {
  'bad-key': 'รหัสไม่ครบหรือพิมพ์ผิด — 20 ตัว เช่น K7QM-2XRP-H9TD-W4NC-8FJV',
  'wrong-key': 'รหัสไม่ถูกต้อง',
  'view-key': 'นี่คือรหัสดูยอด ใช้แทนเครื่องร้านไม่ได้ — ใช้ “รหัสเครื่องร้าน” จากเครื่องร้านเดิม',
  'has-sales': 'เครื่องนี้มีการขายของตัวเองอยู่แล้ว ใช้เป็นเครื่องร้านแทนไม่ได้',
  offline: 'ต่ออินเทอร์เน็ตไม่ได้ ลองใหม่เมื่อมีสัญญาณ',
};

/**
 * Online sync (CLAUDE.md §8): off, the shop phone, or a view-only device.
 *
 * The shop phone sends; anything else that has the shop's key can only look.
 * Every action here is off the sell path and says plainly how it went.
 */
export default function SyncPanel({ initialKey = '' }: { initialKey?: string }) {
  const state = useSyncState();
  const pending = usePendingCount();
  const [key, setKey] = useState(initialKey);
  const [setupCode, setSetupCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [confirm, setConfirm] = useState<'rotate' | 'stop' | null>(null);
  const [showShopKey, setShowShopKey] = useState(false);

  if (!state) return null;

  async function run(action: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const problem = await action();
      setMessage(problem ? { text: problem, bad: true } : null);
    } finally {
      setBusy(false);
    }
  }

  const notice = message ? (
    <p
      role={message.bad ? 'alert' : 'status'}
      className={`mt-3 rounded-xl px-4 py-3 text-lg font-bold ${
        message.bad ? 'bg-expired text-white' : 'bg-paper-sunk'
      }`}
    >
      {message.text}
    </p>
  ) : state.error ? (
    <p role="alert" className="bg-today mt-3 rounded-xl px-4 py-3 text-lg font-bold">
      ครั้งล่าสุดไม่สำเร็จ: {state.error}
    </p>
  ) : null;

  if (state.mode === 'SHOP' && state.key) {
    const shopKey = state.key;
    const viewKey = state.viewKey;
    return (
      <div>
        <p className="mt-2 text-lg font-bold">
          เครื่องนี้คือเครื่องขายของร้าน — ส่งข้อมูลขึ้นออนไลน์ให้เอง เมื่อมีสัญญาณ
        </p>
        <dl className="mt-3 space-y-1 text-lg font-bold">
          <div className="flex justify-between gap-3">
            <dt>ส่งล่าสุด</dt>
            <dd className="tabular-nums">
              {state.lastSent ? formatBangkok(state.lastSent) : 'ยังไม่เคย'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>รอส่ง</dt>
            <dd className="tabular-nums">{pending ?? '—'} รายการ</dd>
          </div>
        </dl>
        {notice}
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await sendChanges();
              return null;
            })
          }
          className="mt-3 w-full"
        >
          {busy ? 'กำลังส่ง…' : 'ส่งตอนนี้'}
        </Button>

        <h3 className="mt-6 text-xl font-bold">ให้เครื่องอื่นดูยอดร้าน</h3>
        <p className="text-lg font-bold">รหัสดูยอด — ดูได้อย่างเดียว แก้หรือส่งข้อมูลไม่ได้</p>
        <p className="bg-paper-sunk mt-2 rounded-xl px-2 py-3 text-center text-xl font-bold whitespace-nowrap tabular-nums">
          {viewKey ? formatKey(viewKey) : '—'}
        </p>
        <Button
          variant="secondary"
          onClick={() =>
            viewKey &&
            void shareText(`ดูยอดร้านฤดูชา: ${pairLink(viewKey)}`).then(
              (outcome) =>
                outcome === 'copied' &&
                setMessage({ text: 'คัดลอกลิงก์แล้ว — ส่งให้เครื่องที่จะดู', bad: false }),
            )
          }
          className="mt-2 w-full"
        >
          ส่งลิงก์ให้เครื่องที่จะดู
        </Button>

        <h3 className="mt-6 text-xl font-bold">รหัสเครื่องร้าน</h3>
        <p className="text-lg font-bold">
          ใช้ตอนย้ายไปมือถือเครื่องใหม่เท่านั้น — ส่งข้อมูลได้ อย่าส่งให้ใคร
        </p>
        {showShopKey ? (
          <p className="border-ink mt-2 rounded-xl border-2 px-2 py-3 text-center text-xl font-bold whitespace-nowrap tabular-nums">
            {formatKey(shopKey)}
          </p>
        ) : (
          <Button variant="secondary" onClick={() => setShowShopKey(true)} className="mt-2 w-full">
            แสดงรหัสเครื่องร้าน
          </Button>
        )}

        {confirm === 'rotate' ? (
          <Confirm
            text="เปลี่ยนรหัสทั้งสองอัน? เครื่องที่ดูอยู่ทุกเครื่องต้องใส่รหัสดูยอดใหม่"
            yes="เปลี่ยนรหัส"
            onNo={() => setConfirm(null)}
            onYes={() => {
              setConfirm(null);
              void run(async () => ((await rotateKey()) ? null : 'เปลี่ยนรหัสไม่สำเร็จ'));
            }}
          />
        ) : confirm === 'stop' ? (
          <Confirm
            text="ปิดซิงค์ในเครื่องนี้? ข้อมูลออนไลน์ยังอยู่ เปิดใหม่ได้ด้วยรหัสร้าน"
            yes="ปิดซิงค์"
            onNo={() => setConfirm(null)}
            onYes={() => {
              setConfirm(null);
              void stopSync();
            }}
          />
        ) : (
          <div className="mt-6 flex flex-col gap-2">
            <Button variant="secondary" onClick={() => setConfirm('rotate')} className="w-full">
              เปลี่ยนรหัสร้าน (เครื่องหาย)
            </Button>
            <Button variant="secondary" onClick={() => setConfirm('stop')} className="w-full">
              ปิดซิงค์ในเครื่องนี้
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (state.mode === 'VIEWER') {
    return (
      <div>
        <p className="mt-2 text-lg font-bold">เครื่องนี้ดูยอดร้านอย่างเดียว — ขายของไม่ได้</p>
        <p className="mt-1 text-lg font-bold tabular-nums">
          อัปเดตล่าสุด {state.lastFetched ? formatBangkok(state.lastFetched) : 'ยังไม่เคย'}
        </p>
        {notice}
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await fetchChanges();
              return null;
            })
          }
          className="mt-3 w-full"
        >
          {busy ? 'กำลังอัปเดต…' : 'อัปเดตตอนนี้'}
        </Button>
        {confirm === 'stop' ? (
          <Confirm
            text="เลิกดูยอดร้าน? ข้อมูลที่ดาวน์โหลดไว้ในเครื่องนี้จะถูกลบ"
            yes="เลิกดู"
            onNo={() => setConfirm(null)}
            onYes={() => {
              setConfirm(null);
              void stopSync().then(() => resetAndReseed(db));
            }}
          />
        ) : (
          <Button variant="secondary" onClick={() => setConfirm('stop')} className="mt-6 w-full">
            เลิกดูยอดร้าน
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="mt-2 text-lg font-bold">
        ส่งข้อมูลร้านขึ้นออนไลน์ เป็นสำรองข้อมูลอีกชั้น
        และให้มือถือหรือคอมเครื่องอื่นดูยอดได้จากที่บ้าน
      </p>
      {notice}
      <h3 className="mt-4 text-xl font-bold">เครื่องนี้คือเครื่องขายของร้าน</h3>
      <TextField
        label="รหัสตั้งค่า"
        value={setupCode}
        onChange={setSetupCode}
        hint="รหัสที่ตั้งไว้ใน Cloudflare (SYNC_SETUP_CODE) — ใช้ครั้งเดียวตอนเปิดซิงค์"
      />
      <Button
        variant="primary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const result = await startAsShop(setupCode);
            return result === 'ok' ? null : SETUP_TH[result];
          })
        }
        className="mt-2 w-full"
      >
        เปิดซิงค์ออนไลน์
      </Button>

      <h3 className="mt-6 text-xl font-bold">ใช้เครื่องนี้ดูยอดร้าน</h3>
      <TextField
        label="รหัสร้าน"
        value={key}
        onChange={setKey}
        hint="ดูยอด: ใช้รหัสดูยอด · ใช้แทนเครื่องร้านเดิม: ใช้รหัสเครื่องร้าน (มือถือเครื่องใหม่ ดึงข้อมูลทั้งหมดมาขายต่อ)"
      />
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const result = await joinWithKey(key, 'VIEWER');
            return result === 'ok' ? null : JOIN_TH[result];
          })
        }
        className="mt-2 w-full"
      >
        ดูยอดร้าน (ดูอย่างเดียว)
      </Button>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const result = await joinWithKey(key, 'SHOP');
            return result === 'ok' ? null : JOIN_TH[result];
          })
        }
        className="mt-2 w-full"
      >
        ใช้แทนเครื่องร้านเดิม
      </Button>
    </div>
  );
}

function Confirm({
  text,
  yes,
  onYes,
  onNo,
}: {
  text: string;
  yes: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="border-expired mt-6 rounded-xl border-2 p-3">
      <p className="text-xl font-bold">{text}</p>
      <div className="mt-2 flex gap-2">
        <Button variant="secondary" onClick={onNo} className="flex-1">
          ไม่
        </Button>
        <Button variant="danger" onClick={onYes} className="flex-1">
          {yes}
        </Button>
      </div>
    </div>
  );
}
