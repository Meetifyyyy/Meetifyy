import { useNavigate, useParams, Navigate, useLocation } from 'react-router-dom';
import CommunityView from '../components/view/CommunityView';
import { useCommunities } from '@shared/hooks/useCommunities';

export default function CommunityDetailRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const { communities } = useCommunities();

  const comm = communities[id];

  if (comm?.isUniversity) {
    return <Navigate to={`/campus`} replace />;
  }

  const handleBack = () => {
    navigate(location.state?.from ?? '/communities', { replace: true });
  };

  const handlePostClick = (post, sourceContext, communityId) => {
    if (post.id) {
      navigate(`/post/${post.id}`, { state: { post, sourceContext, communityId, from: location.pathname } });
    }
  };

  return (
    <main className="centre centre-wide">
      <CommunityView 
        communityId={id} 
        onBack={handleBack} 
        onPostClick={handlePostClick}
      />
    </main>
  );
}
