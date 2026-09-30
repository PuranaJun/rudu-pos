import { useState } from 'react';
import MenuSettings from './settings/MenuSettings.tsx';
import ComponentSettings from './settings/ComponentSettings.tsx';
import PackagingSettings from './settings/PackagingSettings.tsx';
import ModifierSettings from './settings/ModifierSettings.tsx';
import ShopSettings from './settings/ShopSettings.tsx';
import DataSettings from './settings/DataSettings.tsx';
import { ChoiceChip } from '../components/Button.tsx';
import LeaveGuardProvider from '../components/LeaveGuardProvider.tsx';
import { useLeaveGuard } from '../components/leave-guard.ts';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../components/Screen.tsx';
import { useCostCatalog, useSettings } from '../db/hooks.ts';

const TABS = [
  ['MENU', 'เครื่องดื่ม'],
  ['COMPONENTS', 'ส่วนประกอบ'],
  ['PACKAGING', 'บรรจุภัณฑ์'],
  ['MODIFIERS', 'ท็อปปิ้ง'],
  ['SHOP', 'ร้าน'],
  ['DATA', 'ข้อมูล'],
] as const;

type Tab = (typeof TABS)[number][0];

/**
 * Settings (CLAUDE.md §2.1.7, §12): every recipe, price and cost, editable.
 *
 * The recipes have not been taste-tested and will change, so nothing about
 * them lives in the code — it lives here. Every change applies from the next
 * sale on; what was already sold keeps the price and cost it was sold at.
 *
 * All six sections are on screen at once — a row that scrolls sideways hides
 * the last ones, and the last one is the backup. Each section draws its own
 * body and footer: a list's footer leaves settings, an editor's footer goes
 * back to its list and saves. Nothing typed is lost without being asked.
 */
export default function SettingsScreen({ back }: { back: BackTo }) {
  return (
    <LeaveGuardProvider>
      <Settings back={back} />
    </LeaveGuardProvider>
  );
}

function Settings({ back }: { back: BackTo }) {
  const catalog = useCostCatalog();
  const settings = useSettings();
  const guard = useLeaveGuard();
  const [tab, setTab] = useState<Tab>('MENU');

  return (
    <Screen
      title="ตั้งค่า"
      below={
        <nav aria-label="หมวด" className="tablet:grid-cols-6 mt-2 grid grid-cols-2 gap-2">
          {TABS.map(([id, label]) => (
            <ChoiceChip
              key={id}
              selected={tab === id}
              onClick={() => guard.leave(() => setTab(id))}
            >
              {label}
            </ChoiceChip>
          ))}
        </nav>
      }
    >
      {!catalog || !settings ? (
        <>
          <ScreenBody>
            <p className="py-6 text-lg font-bold">กำลังโหลด…</p>
          </ScreenBody>
          <ScreenFooter back={back} />
        </>
      ) : tab === 'MENU' ? (
        <MenuSettings catalog={catalog} exit={back} />
      ) : tab === 'COMPONENTS' ? (
        <ComponentSettings catalog={catalog} exit={back} />
      ) : tab === 'PACKAGING' ? (
        <PackagingSettings catalog={catalog} exit={back} />
      ) : tab === 'MODIFIERS' ? (
        <ModifierSettings catalog={catalog} exit={back} />
      ) : tab === 'SHOP' ? (
        <ShopSettings catalog={catalog} settings={settings} exit={back} />
      ) : (
        <DataSettings exit={back} />
      )}
    </Screen>
  );
}
