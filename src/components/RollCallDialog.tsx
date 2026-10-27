import { useState } from 'react';
import type { SessionDetail } from '../types';
import { Modal } from './Modal';
import { RollCallFlow, type RollCallFlowState } from './RollCallFlow';

interface RollCallDialogProps {
  open: boolean;
  session: SessionDetail;
  onClose: () => void;
  onSettled: (session: SessionDetail, created: number) => void;
}
/** Legacy dialog wrapper; the flow owns its one draft and close guard. */
export function RollCallDialog({ open, session, onClose, onSettled }: RollCallDialogProps): JSX.Element {
  const [flow, setFlow] = useState<RollCallFlowState | null>(null);
  return <Modal open={open} onClose={() => flow ? flow.requestClose() : onClose()}
    labelledBy="rollcall-title" size="lg" dismissible={!flow?.dirty} historyKey="rollcall">
    <RollCallFlow session={session} titleId="rollcall-title" onClose={onClose} onSettled={onSettled} variant="dialog" onStateChange={setFlow} />
  </Modal>;
}
