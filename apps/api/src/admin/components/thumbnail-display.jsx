import React from 'react';
import { Box } from '@adminjs/design-system';

const ThumbnailDisplay = (props) => {
  const { record, property } = props;
  const thumbnailUrl = record.params[property.path];
  const webpageUrl = record.params['metadata.webpageUrl'];

  if (!thumbnailUrl) {
    return (
      <Box>
        <div style={{
          width: '80px',
          height: '60px',
          backgroundColor: '#f3f4f6',
          border: '1px solid #e5e7eb',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          color: '#6b7280'
        }}>
          No Image
        </div>
      </Box>
    );
  }

  return (
    <Box>
      <a href={webpageUrl} target="_blank" rel="noopener noreferrer">
        <img
          src={thumbnailUrl}
          alt="Thumbnail"
          style={{
            width: '80px',
            height: '60px',
            objectFit: 'cover',
            borderRadius: '4px',
            border: '1px solid #e5e7eb'
          }}
          onError={(e) => {
            e.target.style.display = 'none';
            e.target.nextSibling.style.display = 'flex';
          }}
        />
      </a>
      <div style={{
        width: '80px',
        height: '60px',
        backgroundColor: '#f3f4f6',
        border: '1px solid #e5e7eb',
        borderRadius: '4px',
        display: 'none',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        color: '#6b7280'
      }}>
        Invalid Image
      </div>
    </Box>
  );
};

export default ThumbnailDisplay;