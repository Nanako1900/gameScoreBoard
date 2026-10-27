import { goBack } from '../lib/router';
import { GuideContent } from './GuideContent';
import { Modal } from './Modal';
import { PageBar } from './PageBar';

export function GuidePage(): JSX.Element {
  return <Modal open variant="page" labelledBy="guide-page-title" onClose={goBack}>
    <PageBar backLabel="返回" onBack={goBack} title="机器人指南" />
    <h2 id="guide-page-title" tabIndex={-1}>机器人指南</h2>
    <GuideContent />
  </Modal>;
}
