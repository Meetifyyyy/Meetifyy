import { useNavigate } from 'react-router-dom';
import CommunitiesBrowse from '../components/communities/CommunitiesBrowse';

export default function CommunitiesRoute() {
  const navigate = useNavigate();

  const handleOpenCommunity = (id) => {
    navigate(`/communities/${id}`);
  };

  return (
    <main className="centre centre-wide animate-in">
      <CommunitiesBrowse onOpenCommunity={handleOpenCommunity} />
    </main>
  );
}
