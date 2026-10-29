import { Navigate, useParams } from 'react-router-dom';

/**
 * meetifyy.app/g/<code>: an invite link, opened from anywhere (WhatsApp, a
 * browser, a copied URL, an App Link into the installed app).
 *
 * It is a protected route, so someone signed out is sent through sign-in (or
 * sign-up) with this path kept as the place to come back to, and lands here
 * again afterwards. Here it hands over to Messages with the code, and
 * Messages opens the same group preview a chat's invite card opens, over the
 * inbox; closing it leaves the person in Messages.
 *
 * The code is passed on as it came. The server checks it (shape first, then
 * the link) and answers "This invite link isn't valid" for anything it is not.
 */
export default function GroupInviteLinkRoute() {
  const { code = '' } = useParams();
  return <Navigate to="/messages" replace state={{ groupInvite: { code: code.slice(0, 64) } }} />;
}
