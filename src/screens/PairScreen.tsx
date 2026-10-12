import SyncPanel from '../components/SyncPanel.tsx';
import { Screen, ScreenBody, ScreenFooter } from '../components/Screen.tsx';

/**
 * Opened from a pairing link the shop phone shared: the key is already filled
 * in, and the obvious button is "ดูยอดร้าน". Nothing is joined until it is
 * pressed.
 */
export default function PairScreen({
  initialKey,
  onDone,
}: {
  initialKey: string;
  onDone: () => void;
}) {
  return (
    <Screen title="ดูยอดร้าน">
      <ScreenBody>
        <SyncPanel initialKey={initialKey} />
      </ScreenBody>
      <ScreenFooter back={{ label: 'ไม่ใช่ตอนนี้', onClick: onDone }} />
    </Screen>
  );
}
