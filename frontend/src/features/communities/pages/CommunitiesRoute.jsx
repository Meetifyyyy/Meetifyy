import { useNavigate } from 'react-router-dom';
import PageLayout from '@layout/PageLayout';
import CommunitiesBrowse from '../components/browse/CommunitiesBrowse';

export default function CommunitiesRoute() {
  const navigate = useNavigate();

  const handleOpenCommunity = (id) => {
    navigate(`/communities/${id}`);
  };

  return (
    <PageLayout style={{ paddingLeft: 0, paddingRight: 0 }}>
      <CommunitiesBrowse onOpenCommunity={handleOpenCommunity} />
    </PageLayout>
  );
}
