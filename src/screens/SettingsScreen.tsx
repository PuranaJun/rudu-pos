import { useState } from 'react';
import MenuSettings from './settings/MenuSettings.tsx';
import ComponentSettings from './settings/ComponentSettings.tsx';
import PackagingSettings from './settings/PackagingSettings.tsx';
import ModifierSettings from './settings/ModifierSettings.tsx';
import ShopSettings from './settings/ShopSettings.tsx';
import { useCostCatalog, useSettings } from '../db/hooks.ts';

const TABS = [
  ['MENU', 'เมนู'],
  ['COMPONENTS', 'ส่วนประกอบ'],
  ['PACKAGING', 'บรรจุภัณฑ์'],
  ['MODIFIERS', 'ท็อปปิ้ง'],
  ['SHOP', 'ร้าน'],
] as const;

type Tab = (typeof TABS)[number][0];

/**
 * Settings (CLAUDE.md §2.1.7, §12): every recipe, price and cost, editable.
 *
 * The recipes have not been taste-tested and will change, so nothing about
 * them lives in the code — it lives here. Every change applies from the next
 * sale on; what was already sold keeps the price and cost it was sold at.
 */
export default function SettingsScreen({ onClose }: { onClose: () => void }) {
  const catalog = useCostCatalog();
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>('MENU');

  return (
    <div
      role="dialog"
      aria-label="ตั้งค่า"
      className="safe-x text-ink fixed inset-0 z-30 flex flex-col bg-white"
    >
      <header className="safe-top border-line border-b px-4 pb-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">ตั้งค่า</h1>
          <button
            type="button"
            onClick={onClose}
            className="bg-ink min-h-touch rounded-xl px-5 text-lg font-bold text-white"
          >
            เสร็จ
          </button>
        </div>
        <nav aria-label="หมวด" className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={`min-h-touch shrink-0 rounded-xl border-2 px-3 text-lg font-bold ${
                tab === id ? 'bg-ink border-ink text-white' : 'border-line'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {/* No footer bar here, so the list itself keeps clear of the home indicator. */}
      <main className="safe-bottom min-h-0 flex-1 overflow-y-auto px-4">
        {!catalog || !settings ? null : tab === 'MENU' ? (
          <MenuSettings catalog={catalog} />
        ) : tab === 'COMPONENTS' ? (
          <ComponentSettings catalog={catalog} />
        ) : tab === 'PACKAGING' ? (
          <PackagingSettings catalog={catalog} />
        ) : tab === 'MODIFIERS' ? (
          <ModifierSettings catalog={catalog} />
        ) : (
          <ShopSettings catalog={catalog} settings={settings} />
        )}
      </main>
    </div>
  );
}
