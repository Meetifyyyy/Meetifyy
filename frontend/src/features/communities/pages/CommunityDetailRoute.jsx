import { useNavigate, useParams, Navigate, useLocation } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import CommunityView from '../components/view/CommunityView';
import { useCommunities } from '@shared/hooks/useCommunities';
import NotFoundState from '@shared/components/ui/NotFoundState';

export default function CommunityDetailRoute() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const location = useLocation();
  const { id } = useParams();
  const { communitiesById } = useCommunities();

  const comm = communitiesById[id];

  if (comm?.isUniversity) {
    return <Navigate to={`/campus`} replace />;
  }

  const handleBack = () => {
    goBack('/communities');
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
