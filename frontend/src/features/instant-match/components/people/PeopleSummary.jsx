import Face from '../art/Face';
import { ChevronRightIcon } from '../art/icons';
import '../../styles/searching-screen.css';

/**
 * Who is searching, folded to one box: up to five overlapping faces and who
 * they are in a line. The whole box is the button that slides to the list.
 */
export default function PeopleSummary({ people, detail, onOpen }) {
  if (!people?.length) return null;

  return (
    <button type="button" className="im-also" onClick={onOpen}>
      <span className="im-also-stack" aria-hidden="true">
        {people.slice(0, 5).map((p) => (
          <Face
            key={p.user.id}
            avatar={p.user.avatar}
            name={p.user.displayName || p.user.username}
            size={30}
          />
        ))}
      </span>
      <span className="im-also-summary">
        <strong>{whoLine(people)}</strong>
        {detail && <span className="im-also-same">{detail}</span>}
      </span>
      <ChevronRightIcon />
    </button>
  );
}

function first(p) {
  const full = p.user.displayName || p.user.username || 'Someone';
  return full.trim().split(/\s+/)[0];
}

/** "Aarav is searching", "Aarav and Sana are…", "Aarav, Sana and 3 others are…". */
export function whoLine(people) {
  const n = people.length;
  if (n === 1) return `${first(people[0])} is searching`;
  if (n === 2) return `${first(people[0])} and ${first(people[1])} are searching`;
  const rest = n - 2;
  return `${first(people[0])}, ${first(people[1])} and ${rest} other${rest === 1 ? '' : 's'} are searching`;
}
