import { useState } from 'react';
import { Choice, Editor, NumberField, TextField, Toggle } from '../../components/form.tsx';
import { parseNumber } from '../../lib/number.ts';
import { bahtInput, parseBaht } from '../../lib/money.ts';
import { imageToDataUrl } from '../../lib/image.ts';
import type { CostCatalog } from '../../domain/cost.ts';
import type { PosSettings } from '../../db/settings-repo.ts';
import { saveSetting } from '../../db/catalog-repo.ts';
import type { SettingValue } from '../../db/types.ts';
import { Saved } from './shared.tsx';
import { problemsOf } from './problems.ts';

/**
 * The shop: promotions, the float, the tender buttons, the day's fixed cost,
 * who works here, what the receipt says, and the printed PromptPay QR.
 */
export default function ShopSettings({
  catalog,
  settings,
}: {
  catalog: CostCatalog;
  settings: PosSettings;
}) {
  const [twoCupOn, setTwoCupOn] = useState(settings.twoCupEnabled);
  const [twoCupAmount, setTwoCupAmount] = useState(bahtInput(settings.twoCupAmount));
  const [rainyAmount, setRainyAmount] = useState(bahtInput(settings.rainyDayAmount));
  const [rainyVariant, setRainyVariant] = useState(settings.rainyDayVariantId ?? 'NONE');
  const [float, setFloat] = useState(bahtInput(settings.openingFloat));
  const [tender, setTender] = useState(settings.quickTender.map(bahtInput).join(', '));
  const [fixedCost, setFixedCost] = useState(bahtInput(settings.fixedCostPerDay));
  const [breakevenCups, setBreakevenCups] = useState(String(settings.breakevenCups));
  const [stamps, setStamps] = useState(String(settings.loyaltyStampsRequired));
  const [operators, setOperators] = useState(settings.operators.join('\n'));
  const [voidReasons, setVoidReasons] = useState(settings.voidReasons.join('\n'));
  const [branding, setBranding] = useState(settings.brandingLineTh);
  const [threshold, setThreshold] = useState(bahtInput(settings.annualRevenueThreshold));
  const [warnPercent, setWarnPercent] = useState(
    String(Math.round(settings.annualRevenueWarnRatio * 100)),
  );
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const variants = [...catalog.variants.values()].filter((variant) => variant.is_active);

  function save() {
    const money = {
      promo_two_cup_amount: parseBaht(twoCupAmount),
      promo_rainy_day_amount: parseBaht(rainyAmount),
      opening_float: parseBaht(float),
      fixed_cost_per_day: parseBaht(fixedCost),
      annual_revenue_warn_threshold: parseBaht(threshold),
    };
    const tenderList = tender
      .split(/[,\s]+/)
      .filter((part) => part !== '')
      .map(parseBaht);
    const cups = parseNumber(breakevenCups);
    const stampCount = parseNumber(stamps);
    const percent = parseNumber(warnPercent);
    const lines = (text: string) =>
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');

    const wrong: string[] = [];
    if (Object.values(money).some((value) => value === null)) wrong.push('จำนวนเงินต้องเป็นตัวเลข');
    if (tenderList.length === 0 || tenderList.some((value) => value === null || value === 0)) {
      wrong.push('ปุ่มรับเงินต้องเป็นตัวเลข คั่นด้วยจุลภาค');
    }
    if (cups === null || cups <= 0 || stampCount === null || stampCount <= 0) {
      wrong.push('จำนวนแก้วต้องมากกว่า 0');
    }
    if (percent === null || percent <= 0 || percent > 100)
      wrong.push('เตือนที่ต้องอยู่ระหว่าง 1–100%');
    if (lines(operators).length === 0) wrong.push('ต้องมีคนขายอย่างน้อยหนึ่งคน');
    if (lines(voidReasons).length === 0) wrong.push('ต้องมีเหตุผลยกเลิกอย่างน้อยหนึ่งข้อ');
    if (wrong.length > 0) return setProblems(wrong);

    const rows: Record<string, SettingValue> = {
      ...(money as Record<string, number>),
      promo_two_cup_enabled: twoCupOn,
      promo_rainy_day_variant_id: rainyVariant === 'NONE' ? null : rainyVariant,
      quick_tender: tenderList as number[],
      breakeven_cups: cups!,
      loyalty_stamps_required: stampCount!,
      operators: lines(operators),
      void_reasons: lines(voidReasons),
      branding_line_th: branding.trim(),
      annual_revenue_warn_ratio: percent! / 100,
    };

    Promise.all(Object.entries(rows).map(([key, value]) => saveSetting(key, value)))
      .then(() => {
        setProblems([]);
        setSaved(true);
      })
      .catch((cause: unknown) => setProblems(problemsOf(cause)));
  }

  return (
    <Editor title="ร้าน" problems={problems} onSave={save}>
      <h3 className="mt-4 text-xl font-bold">โปรโมชั่น</h3>
      <Toggle label="ลดคู่ละ (2 แก้ว)" value={twoCupOn} onChange={setTwoCupOn} />
      <NumberField label="ลดต่อคู่" value={twoCupAmount} onChange={setTwoCupAmount} suffix="บาท" />
      <Choice
        label="โปรวันฝนตก ใช้กับ"
        value={rainyVariant}
        options={[
          ['NONE', 'ไม่มี'] as const,
          ...variants.map((variant) => [variant.id, variant.name_th] as const),
        ]}
        onChange={setRainyVariant}
      />
      <NumberField label="ลดวันฝนตก" value={rainyAmount} onChange={setRainyAmount} suffix="บาท" />
      <NumberField
        label="แสตมป์ครบ (แลกฟรี 1 แก้ว)"
        value={stamps}
        onChange={setStamps}
        suffix="ดวง"
      />

      <h3 className="mt-6 text-xl font-bold">เงิน</h3>
      <NumberField label="เงินทอนเริ่มต้น" value={float} onChange={setFloat} suffix="บาท" />
      <TextField
        label="ปุ่มรับเงิน"
        value={tender}
        onChange={setTender}
        hint="เป็นบาท คั่นด้วยจุลภาค เช่น 40, 50, 59, 100, 500, 1000"
      />
      <NumberField
        label="ค่าใช้จ่ายคงที่ต่อวัน"
        value={fixedCost}
        onChange={setFixedCost}
        suffix="บาท"
      />
      <NumberField
        label="จุดคุ้มทุนประมาณ"
        value={breakevenCups}
        onChange={setBreakevenCups}
        suffix="แก้ว"
      />
      <NumberField
        label="เกณฑ์จดทะเบียน VAT"
        value={threshold}
        onChange={setThreshold}
        suffix="บาท/ปี"
      />
      <NumberField
        label="เริ่มเตือนเมื่อถึง"
        value={warnPercent}
        onChange={setWarnPercent}
        suffix="%"
      />

      <h3 className="mt-6 text-xl font-bold">ร้าน</h3>
      <TextField
        label="คนขาย"
        value={operators}
        onChange={setOperators}
        multiline
        hint="บรรทัดละคน"
      />
      <TextField
        label="เหตุผลยกเลิกบิล"
        value={voidReasons}
        onChange={setVoidReasons}
        multiline
        hint="บรรทัดละข้อ"
      />
      <TextField label="ข้อความบนใบเสร็จ" value={branding} onChange={setBranding} />
      <Saved show={saved} />

      <QrUpload current={settings.promptPayQrImage} />
    </Editor>
  );
}

/**
 * The printed PromptPay QR, photographed once. The phone only shows it; the
 * customer's banking app is what moves the money, and nothing here checks
 * that it arrived (CLAUDE.md §4).
 */
function QrUpload({ current }: { current: string | null }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-6" role="group" aria-label="QR พร้อมเพย์">
      <h3 className="text-xl font-bold">QR พร้อมเพย์</h3>
      {current ? (
        <img
          src={current}
          alt="QR พร้อมเพย์"
          className="border-line mt-2 w-48 rounded-xl border-2"
        />
      ) : (
        <p className="mt-1 text-lg font-semibold">ยังไม่มีรูป</p>
      )}
      <label className="bg-ink min-h-touch mt-2 flex w-full items-center justify-center rounded-xl text-lg font-bold text-white">
        {current ? 'เปลี่ยนรูป' : 'เลือกรูป'}
        <input
          type="file"
          accept="image/*"
          aria-label="รูป QR พร้อมเพย์"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            imageToDataUrl(file)
              .then((dataUrl) => saveSetting('promptpay_qr_image', dataUrl))
              .then(() => setError(null))
              .catch((cause: unknown) => setError(`บันทึกรูปไม่สำเร็จ: ${String(cause)}`));
          }}
        />
      </label>
      {current ? (
        <button
          type="button"
          onClick={() => void saveSetting('promptpay_qr_image', null)}
          className="border-line min-h-touch mt-2 w-full rounded-xl border-2 text-lg font-bold"
        >
          ลบรูป
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-lg font-bold">
          {error}
        </p>
      ) : null}
    </div>
  );
}
