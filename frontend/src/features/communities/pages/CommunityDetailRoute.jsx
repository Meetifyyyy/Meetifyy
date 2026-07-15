import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useData } from '@shared/context/DataContext';
import CommunityView from '../components/view/CommunityView';

export default function CommunityDetailRoute() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { communities } = useData();
  const goBack = useSmartBack();

  const comm = communities[id];

  if (comm?.isUniversity) {
    return <Navigate to={`/campus`} replace />;
  }

  const handleBack = () => {
    goBack('/communities');
  };

  const handlePostClick = (post, sourceContext, communityId) => {
    if (post.id) {
      navigate(`/post/${post.id}`, { state: { post, sourceContext, communityId } });
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
