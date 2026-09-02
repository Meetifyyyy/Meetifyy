/**
 * Not Found for visitors without a session.
 *
 * Signed-out visitors who hit an unknown url used to be sent to '/' by
 * ProtectedRoute. That was wrong twice over. For a person, a dead link silently
 * dropped them on the landing page with no indication that the thing they
 * clicked no longer exists. For a crawler, every dead url answered 200 and
 * rendered the homepage, so a retired link became another duplicate of '/'
 * rather than a page that could be dropped from the index.
 *
 * Wrapped in the landing chrome rather than the dashboard shell, because the
 * dashboard shell assumes a session: header, sidebar and bottom nav are all
 * built from `currentUser`. This keeps a signed-out 404 looking like part of
 * the public site, with the navigation needed to get somewhere useful.
 */
import { useNavigate } from 'react-router-dom';
import LandingNavbar from '@features/auth/landing/components/LandingNavbar';
import LandingFooter from '@features/auth/landing/components/LandingFooter';
import '@features/auth/landing/landing.css';
import NotFoundState from './ui/NotFoundState';

export default function PublicNotFound() {
  const navigate = useNavigate();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <LandingNavbar />
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <NotFoundState
          type="page"
          coverPage={false}
          // "Back to Home Feed" is the default and it is meaningless here:
          // there is no feed without an account, and the link would bounce
          // straight back through ProtectedRoute.
          actionLabel="Back to home"
          onAction={() => navigate('/', { replace: true })}
        />
      </main>
      <LandingFooter />
    </div>
  );
}
