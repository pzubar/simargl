import React from 'react';
import { Box, Text } from '@adminjs/design-system';

const AnalysisDisplay = (props) => {
  const { record, property } = props;
  
  // AdminJS flattens nested objects, so we need to reconstruct the analysis structure
  const reconstructAnalysis = (params) => {
    const analysis = {};
    
    // Get all keys that start with 'analysis.result.'
    const analysisKeys = Object.keys(params).filter(key => key.startsWith('analysis.result.'));
    
    analysisKeys.forEach(key => {
      // Remove 'analysis.result.' prefix and split the remaining path
      const path = key.replace('analysis.result.', '').split('.');
      let current = analysis;
      
      // Build nested structure
      for (let i = 0; i < path.length - 1; i++) {
        const segment = path[i];
        
        // Check if this segment is a number (array index)
        if (!isNaN(segment) && segment !== '') {
          const parentKey = path[i - 1];
          if (!Array.isArray(current[parentKey])) {
            current[parentKey] = [];
          }
          if (!current[parentKey][parseInt(segment)]) {
            current[parentKey][parseInt(segment)] = {};
          }
          current = current[parentKey][parseInt(segment)];
        } else {
          if (!current[segment]) {
            current[segment] = {};
          }
          current = current[segment];
        }
      }
      
      // Set the final value
      const finalKey = path[path.length - 1];
      const value = params[key];
      
      // Try to parse boolean strings
      if (value === 'true') {
        current[finalKey] = true;
      } else if (value === 'false') {
        current[finalKey] = false;
      } else if (!isNaN(value) && value !== '') {
        current[finalKey] = parseFloat(value);
      } else {
        current[finalKey] = value;
      }
    });
    
    return analysis;
  };
  
  const analysis = reconstructAnalysis(record.params);
  
  // Debug: Log the reconstructed analysis
  console.log('Reconstructed analysis:', analysis);
  console.log('Original record.params keys:', Object.keys(record.params).filter(k => k.startsWith('analysis')));
  
  // Check if we have any analysis data
  if (!analysis || Object.keys(analysis).length === 0) {
    return React.createElement(Box, { 
      padding: 'lg',
      backgroundColor: 'grey10',
      borderRadius: 'md'
    }, 
      React.createElement(Text, { 
        color: 'grey60', 
        fontStyle: 'italic' 
      }, 'No analysis results available')
    );
  }

  try {
    return React.createElement(Box, { padding: 'lg' },
      // Classification Section - Most Important
      analysis.classification && React.createElement(Box, { 
        marginBottom: 'xl',
        padding: 'lg',
        backgroundColor: 'white',
        border: '1px solid',
        borderColor: 'grey20',
        borderRadius: 'md'
      },
        React.createElement(Text, { 
          fontSize: 'xl', 
          fontWeight: 'bold', 
          marginBottom: 'lg',
          display: 'block'
        }, '⚖️ Classification Results'),
        
        // Manipulative Content
        analysis.classification.is_manipulative && React.createElement(Box, { 
          marginBottom: 'lg', 
          padding: 'md', 
          borderRadius: 'md',
          backgroundColor: (analysis.classification.is_manipulative.decision === 'true' || 
                           analysis.classification.is_manipulative.decision === true) ? 'error10' : 'success10'
        },
          React.createElement(Text, { 
            fontWeight: 'bold',
            color: (analysis.classification.is_manipulative.decision === 'true' || 
                   analysis.classification.is_manipulative.decision === true) ? 'error100' : 'success100',
            display: 'block',
            marginBottom: 'sm'
          }, `🚨 Manipulative Content: ${(analysis.classification.is_manipulative.decision === 'true' || 
                                        analysis.classification.is_manipulative.decision === true) ? 'YES' : 'NO'}`),
          React.createElement(Text, { 
            marginBottom: 'xs',
            display: 'block'
          }, React.createElement('strong', {}, 'Confidence: '), analysis.classification.is_manipulative.confidence),
          React.createElement(Text, {
            display: 'block'
          }, React.createElement('strong', {}, 'Reasoning: '), analysis.classification.is_manipulative.reasoning)
        ),
        
        // Disinformation
        analysis.classification.is_disinformation && React.createElement(Box, { 
          padding: 'md', 
          borderRadius: 'md',
          backgroundColor: (analysis.classification.is_disinformation.decision === 'true' || 
                           analysis.classification.is_disinformation.decision === true) ? 'warning10' : 'success10'
        },
          React.createElement(Text, { 
            fontWeight: 'bold',
            color: (analysis.classification.is_disinformation.decision === 'true' || 
                   analysis.classification.is_disinformation.decision === true) ? 'warning100' : 'success100',
            display: 'block',
            marginBottom: 'sm'
          }, `📰 Disinformation: ${(analysis.classification.is_disinformation.decision === 'true' || 
                                   analysis.classification.is_disinformation.decision === true) ? 'YES' : 'NO'}`),
          React.createElement(Text, { 
            marginBottom: 'xs',
            display: 'block'
          }, React.createElement('strong', {}, 'Confidence: '), `${analysis.classification.is_disinformation.confidence}%`),
          React.createElement(Text, {
            display: 'block'
          }, React.createElement('strong', {}, 'Reasoning: '), analysis.classification.is_disinformation.reasoning)
        )
      ),

      // Video Metadata Section
      analysis.metadata && React.createElement(Box, { 
        marginBottom: 'xl',
        padding: 'lg',
        backgroundColor: 'info10',
        borderRadius: 'md'
      },
        React.createElement(Text, { 
          fontSize: 'lg', 
          fontWeight: 'bold', 
          marginBottom: 'md',
          display: 'block'
        }, '📹 Video Metadata'),
        React.createElement(Box, {},
          analysis.metadata.primary_language && React.createElement(Text, { 
            marginBottom: 'xs',
            display: 'block'
          }, React.createElement('strong', {}, 'Language: '), analysis.metadata.primary_language),
          analysis.metadata.video_type && React.createElement(Text, { 
            marginBottom: 'xs',
            display: 'block'
          }, React.createElement('strong', {}, 'Type: '), analysis.metadata.video_type),
          analysis.metadata.content_category && React.createElement(Text, { 
            marginBottom: 'xs',
            display: 'block'
          }, React.createElement('strong', {}, 'Category: '), analysis.metadata.content_category),
          analysis.metadata.hosts_or_speakers && analysis.metadata.hosts_or_speakers.length > 0 && React.createElement(Text, { 
            display: 'block'
          }, React.createElement('strong', {}, 'Speakers: '), analysis.metadata.hosts_or_speakers.join(', '))
        )
      ),

      // Narrative Analysis Section
      analysis.narrative_analysis && React.createElement(Box, { 
        marginBottom: 'xl',
        padding: 'lg',
        backgroundColor: 'primary10',
        borderRadius: 'md'
      },
        React.createElement(Text, { 
          fontSize: 'lg', 
          fontWeight: 'bold', 
          marginBottom: 'md',
          display: 'block'
        }, '📖 Narrative Analysis'),
        React.createElement(Box, {},
          analysis.narrative_analysis.primary_narrative_frame && React.createElement(Box, { marginBottom: 'md' },
            React.createElement(Text, { 
              fontWeight: 'bold',
              display: 'block',
              marginBottom: 'xs'
            }, 'Primary Frame:'),
            React.createElement(Text, { 
              fontStyle: 'italic',
              display: 'block'
            }, analysis.narrative_analysis.primary_narrative_frame)
          ),
          analysis.narrative_analysis.plot_summary && React.createElement(Box, { marginBottom: 'md' },
            React.createElement(Text, { 
              fontWeight: 'bold',
              display: 'block',
              marginBottom: 'xs'
            }, 'Plot Summary:'),
            React.createElement(Text, {
              display: 'block'
            }, analysis.narrative_analysis.plot_summary)
          )
        )
      ),

      // Raw JSON Section
      React.createElement(Box, { 
        padding: 'lg',
        backgroundColor: 'grey10',
        borderRadius: 'md'
      },
        React.createElement(Text, { 
          fontSize: 'md', 
          fontWeight: 'bold', 
          marginBottom: 'sm',
          display: 'block'
        }, '📄 Raw Analysis Data'),
        React.createElement(Box, { 
          padding: 'md', 
          backgroundColor: 'white', 
          borderRadius: 'sm',
          overflow: 'auto',
          maxHeight: '400px'
        },
          React.createElement('pre', { 
            style: {
              fontFamily: 'monospace', 
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              margin: 0,
              wordBreak: 'break-word'
            }
          }, JSON.stringify(analysis, null, 2))
        )
      )
    );
  } catch (error) {
    return React.createElement(Box, { 
      padding: 'lg',
      backgroundColor: 'error10',
      borderRadius: 'md'
    },
      React.createElement(Text, { 
        color: 'error100',
        fontWeight: 'bold',
        display: 'block',
        marginBottom: 'md'
      }, `Error displaying analysis: ${error.message}`),
      React.createElement(Box, { 
        padding: 'md', 
        backgroundColor: 'white', 
        borderRadius: 'sm' 
      },
        React.createElement('pre', { 
          style: {
            fontFamily: 'monospace', 
            fontSize: '12px',
            margin: 0
          }
        }, JSON.stringify(analysis, null, 2))
      )
    );
  }
};

export default AnalysisDisplay; 