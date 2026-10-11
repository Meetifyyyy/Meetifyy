import { HELP_VIEWS } from './helpHub';
import SafetyCentre from './SafetyCentre';
import MyRequests from './MyRequests';

export const VIEW_TITLES = {
  [HELP_VIEWS.SAFETY]: 'Safety centre',
  [HELP_VIEWS.REQUESTS]: 'Your requests',
};

/**
 * One hub sub-view. The host supplies the frame (page hero or Settings
 * header) and opens the report/idea modal.
 *
 * @param {object} p
 * @param {string} p.view
 * @param {(kind: 'problem'|'idea') => void} p.onOpen
 */
export default function HelpView({ view, onOpen }) {
  switch (view) {
    case HELP_VIEWS.SAFETY:
      return <SafetyCentre onOpen={onOpen} />;
    case HELP_VIEWS.REQUESTS:
      return <MyRequests onNewRequest={onOpen} />;
    default:
      return null;
  }
}
