import { Fragment, useId } from 'react';
import BackupCard from '../components/BackupCard.tsx';
import UpdateBanner from '../components/UpdateBanner.tsx';
import VersionStamp from '../components/VersionStamp.tsx';
import { buttonClass } from '../components/button.ts';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../components/Screen.tsx';
import { useCart } from '../db/hooks.ts';
import { useNav } from '../nav/nav-store.ts';
import type { CashSession } from '../db/types.ts';

/**
 * เมนู — everything that is not selling, in one place, in words.
 *
 * A launcher, not a level: each tile opens its screen, and that screen's back
 * button goes straight home rather than back here. The tiles sit at the
 * bottom, in thumb reach; closing the day is set apart so it is never the
 * tile hit on the way to another.
 */
export default function MenuHubScreen({
  session,
  back,
}: {
  session: CashSession | null;
  back: BackTo;
}) {
  const open = useNav((state) => state.open);
  const cart = useCart();
  const dayOpen = session !== null;

  return (
    <Screen title="เมนู">
      <ScreenBody className="flex flex-col">
        {/* Only with an empty cart: switching versions reloads the page. */}
        <UpdateBanner canApply={cart !== undefined && cart.length === 0} />

        <nav aria-label="ไปที่" className="mt-auto pt-4">
          <div className="grid grid-cols-2 gap-3 [&>*:last-child:nth-child(odd)]:col-span-2">
            {dayOpen ? (
              <Tile
                title="บิลวันนี้"
                detail={['ดูบิล', 'ยกเลิกบิล']}
                onOpen={() => open('SALES')}
              />
            ) : null}
            <Tile title="ผลิต" detail={['บันทึกของที่ทำ']} onOpen={() => open('PRODUCTION')} />
            <Tile
              title="รายงาน"
              detail={['วันที่ผ่านมา', 'ทั้งปี']}
              onOpen={() => open('REPORTS')}
            />
            <Tile
              title="ตั้งค่า"
              detail={['เครื่องดื่ม', 'ราคา', 'สูตร']}
              onOpen={() => open('SETTINGS')}
            />
          </div>

          <section aria-label="สำรองข้อมูล" className="mt-5">
            <h2 className="text-xl font-bold">สำรองข้อมูล</h2>
            <div className="mt-2">
              <BackupCard label="สำรองข้อมูล" />
            </div>
          </section>

          {dayOpen ? (
            <div className="border-line mt-5 border-t pt-5">
              <Tile
                title="ปิดร้าน"
                detail={['นับของที่เหลือ', 'นับเงิน', 'สรุปวัน']}
                onOpen={() => open('CLOSE_DAY')}
              />
            </div>
          ) : null}
        </nav>

        <div className="mt-4 flex justify-center">
          <VersionStamp />
        </div>
      </ScreenBody>

      <ScreenFooter back={back} />
    </Screen>
  );
}

/**
 * A destination: its name, big, and what is there. The phrases of the detail
 * never break inside themselves — a line wraps between them or not at all.
 */
function Tile({
  title,
  detail,
  onOpen,
}: {
  title: string;
  detail: readonly string[];
  onOpen: () => void;
}) {
  const id = useId();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-detail`}
      className={`${buttonClass('secondary', 'lg')} flex w-full flex-col items-start justify-center py-3 text-left`}
    >
      <span id={`${id}-title`}>{title}</span>
      <span id={`${id}-detail`} className="text-ink-soft mt-1 text-lg">
        {detail.map((phrase, index) => (
          // The separator stays outside the unbreakable part: the line may
          // wrap at " · ", and only there.
          <Fragment key={phrase}>
            {index > 0 ? ' · ' : ''}
            <span className="whitespace-nowrap">{phrase}</span>
          </Fragment>
        ))}
      </span>
    </button>
  );
}
