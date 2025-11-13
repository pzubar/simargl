import React, { useState, useEffect } from 'react';
// import {ApiClient} from 'adminjs';

const ChunkProgress = (props) => {
  const { record } = props;
  const [chunkProgress, setChunkProgress] = useState({ analyzed: 0, total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchChunkProgress = async () => {
      try {
        // Todo: Replace with API client logic
        const response = await fetch(`/api/contents/${record.params._id}/chunk-progress`);
        const data = await response.json();
        setChunkProgress(data);
      } catch (error) {
        console.error('Error fetching chunk progress:', error);
      } finally {
        setLoading(false);
      }
    };

    if (record?.params?._id) {
      fetchChunkProgress();
    }
  }, [record]);

  if (loading) {
    return <div>Loading chunk progress...</div>;
  }
  
  if (record.params.status === 'ANALYZED') {
    return null;
  }

  return (
    <div>
      <strong>Chunk Progress:</strong> {chunkProgress.analyzed} / {chunkProgress.total}
    </div>
  );
};

export default ChunkProgress; 