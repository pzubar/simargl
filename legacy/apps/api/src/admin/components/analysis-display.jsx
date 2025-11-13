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
  
  // Helper function to convert numbered object to array
  const objectToArray = (obj) => {
    if (!obj || typeof obj !== 'object') return [];
    const keys = Object.keys(obj).filter(key => !isNaN(key)).sort((a, b) => parseInt(a) - parseInt(b));
    return keys.map(key => obj[key]);
  };

  // Check if we have any analysis data
  if (!analysis || Object.keys(analysis).length === 0) {
    return (
      <Box padding="lg" backgroundColor="grey10" borderRadius="md">
        <Text color="grey60" fontStyle="italic">
          No analysis results available
        </Text>
      </Box>
    );
  }

  try {
    return (
      <Box padding="lg">
        {/* Classification Section - Most Important */}
        {analysis.classification && (
          <Box 
            marginBottom="xl"
            padding="lg"
            backgroundColor="white"
            border="1px solid"
            borderColor="grey20"
            borderRadius="md"
          >
            <Text fontSize="xl" fontWeight="bold" marginBottom="lg" display="block">
              ⚖️ Classification Results
            </Text>
            
            {/* Manipulative Content */}
            {analysis.classification.is_manipulative && (
              <Box 
                marginBottom="lg" 
                padding="md" 
                borderRadius="md"
                backgroundColor={analysis.classification.is_manipulative.decision ? 'error10' : 'success10'}
              >
                <Text 
                  fontWeight="bold"
                  color={analysis.classification.is_manipulative.decision ? 'error100' : 'success100'}
                  display="block"
                  marginBottom="sm"
                >
                  🚨 Manipulative Content: {analysis.classification.is_manipulative.decision ? 'YES' : 'NO'}
                </Text>
                <Text marginBottom="xs" display="block">
                  <strong>Confidence:</strong> {Math.round(analysis.classification.is_manipulative.confidence * 100)}%
                </Text>
                <Text display="block">
                  <strong>Reasoning:</strong> {analysis.classification.is_manipulative.reasoning}
                </Text>
              </Box>
            )}
            
            {/* Disinformation */}
            {analysis.classification.is_disinformation && (
              <Box 
                padding="md" 
                borderRadius="md"
                backgroundColor={analysis.classification.is_disinformation.decision ? 'warning10' : 'success10'}
              >
                <Text 
                  fontWeight="bold"
                  color={analysis.classification.is_disinformation.decision ? 'warning100' : 'success100'}
                  display="block"
                  marginBottom="sm"
                >
                  📰 Disinformation: {analysis.classification.is_disinformation.decision ? 'YES' : 'NO'}
                </Text>
                <Text marginBottom="xs" display="block">
                  <strong>Confidence:</strong> {Math.round(analysis.classification.is_disinformation.confidence * 100)}%
                </Text>
                <Text display="block">
                  <strong>Reasoning:</strong> {analysis.classification.is_disinformation.reasoning}
                </Text>
              </Box>
            )}
          </Box>
        )}

        {/* Stance and Thesis Section */}
        {analysis.stance_and_thesis && (
          <Box 
            marginBottom="xl"
            padding="lg"
            backgroundColor="primary10"
            borderRadius="md"
          >
            <Text fontSize="xl" fontWeight="bold" marginBottom="lg" display="block">
              🎯 Stance & Main Thesis
            </Text>
            
            {analysis.stance_and_thesis.russo_ukrainian_war_stance && (
              <Box marginBottom="md">
                <Text fontWeight="bold" display="block" marginBottom="xs">
                  War Stance:
                </Text>
                <Text 
                  display="inline-block"
                  padding="xs"
                  backgroundColor={analysis.stance_and_thesis.russo_ukrainian_war_stance === 'Pro-Ukrainian' ? 'success20' : 
                                  analysis.stance_and_thesis.russo_ukrainian_war_stance === 'Anti-Ukrainian' ? 'error20' : 'warning20'}
                  color={analysis.stance_and_thesis.russo_ukrainian_war_stance === 'Pro-Ukrainian' ? 'success100' : 
                         analysis.stance_and_thesis.russo_ukrainian_war_stance === 'Anti-Ukrainian' ? 'error100' : 'warning100'}
                  borderRadius="sm"
                  fontWeight="bold"
                >
                  {analysis.stance_and_thesis.russo_ukrainian_war_stance}
                </Text>
              </Box>
            )}
            
            {analysis.stance_and_thesis.main_thesis && (
              <Box marginBottom="md">
                <Text fontWeight="bold" display="block" marginBottom="xs">
                  Main Thesis:
                </Text>
                <Text display="block" fontStyle="italic" lineHeight="relaxed">
                  {analysis.stance_and_thesis.main_thesis}
                </Text>
              </Box>
            )}

            {analysis.stance_and_thesis.key_messages && (
              <Box>
                <Text fontWeight="bold" display="block" marginBottom="sm">
                  Key Messages:
                </Text>
                <Box backgroundColor="white" padding="md" borderRadius="sm">
                  {objectToArray(analysis.stance_and_thesis.key_messages).slice(0, 8).map((message, i) => (
                    <Text key={i} display="block" marginBottom="xs" fontSize="sm">
                      <strong>{i + 1}.</strong> {message}
                    </Text>
                  ))}
                  {objectToArray(analysis.stance_and_thesis.key_messages).length > 8 && (
                    <Text fontSize="xs" color="grey60" fontStyle="italic">
                      ... and {objectToArray(analysis.stance_and_thesis.key_messages).length - 8} more messages
                    </Text>
                  )}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* Narrative Analysis Section */}
        {analysis.narrative_analysis && (
          <Box 
            marginBottom="xl"
            padding="lg"
            backgroundColor="info10"
            borderRadius="md"
          >
            <Text fontSize="lg" fontWeight="bold" marginBottom="md" display="block">
              📖 Narrative Analysis
            </Text>
            
            {analysis.narrative_analysis.primary_narrative_frame && (
              <Box marginBottom="md">
                <Text fontWeight="bold" display="block" marginBottom="xs">
                  Primary Frame:
                </Text>
                <Text fontStyle="italic" display="block">
                  {analysis.narrative_analysis.primary_narrative_frame}
                </Text>
              </Box>
            )}
            
            {analysis.narrative_analysis.secondary_narrative_frames && (
              <Box marginBottom="md">
                <Text fontWeight="bold" display="block" marginBottom="xs">
                  Secondary Frames:
                </Text>
                <Box>
                  {objectToArray(analysis.narrative_analysis.secondary_narrative_frames).map((frame, i) => (
                    <Text key={i} display="inline-block" marginRight="xs" marginBottom="xs" 
                          padding="xs" backgroundColor="info20" borderRadius="sm" fontSize="sm">
                      {frame}
                    </Text>
                  ))}
                </Box>
              </Box>
            )}
            
            {analysis.narrative_analysis.plot_summary && (
              <Box marginBottom="md">
                <Text fontWeight="bold" display="block" marginBottom="xs">
                  Plot Summary:
                </Text>
                <Text display="block" lineHeight="relaxed">
                  {analysis.narrative_analysis.plot_summary}
                </Text>
              </Box>
            )}

            {analysis.narrative_analysis.narrative_characters && (
              <Box>
                <Text fontWeight="bold" display="block" marginBottom="sm">
                  Narrative Characters:
                </Text>
                <Box backgroundColor="white" padding="md" borderRadius="sm">
                  {['heroes', 'villains', 'victims'].map((type) => {
                    const characters = analysis.narrative_analysis.narrative_characters[type];
                    if (!characters) return null;
                    
                    return (
                      <Box key={type} marginBottom="sm">
                        <Text fontWeight="bold" fontSize="sm" display="block" marginBottom="xs">
                          {type.charAt(0).toUpperCase() + type.slice(1)}:
                        </Text>
                        <Box>
                          {objectToArray(characters).map((character, i) => (
                            <Text key={i} display="inline-block" marginRight="xs" marginBottom="xs"
                                  padding="xs" fontSize="xs"
                                  backgroundColor={type === 'heroes' ? 'success20' : 
                                                 type === 'villains' ? 'error20' : 'warning20'}
                                  borderRadius="sm">
                              {character}
                            </Text>
                          ))}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* Rhetorical Analysis Section */}
        {analysis.rhetorical_and_emotional_analysis && (
          <Box 
            marginBottom="xl"
            padding="lg"
            backgroundColor="warning10"
            borderRadius="md"
          >
            <Text fontSize="lg" fontWeight="bold" marginBottom="md" display="block">
              🗣️ Rhetorical Analysis
            </Text>
            
            {analysis.rhetorical_and_emotional_analysis.speaker_tone_and_style && (
              <Box marginBottom="md">
                <Text fontWeight="bold" display="block" marginBottom="xs">
                  Tone & Style:
                </Text>
                <Text display="block">
                  {analysis.rhetorical_and_emotional_analysis.speaker_tone_and_style}
                </Text>
              </Box>
            )}
            
            {analysis.rhetorical_and_emotional_analysis.emotional_appeals && (
              <Box marginBottom="md">
                <Text fontWeight="bold" display="block" marginBottom="xs">
                  Emotional Appeals:
                </Text>
                <Box>
                  {objectToArray(analysis.rhetorical_and_emotional_analysis.emotional_appeals).map((appeal, i) => (
                    <Text key={i} display="inline-block" marginRight="xs" marginBottom="xs"
                          padding="xs" backgroundColor="error20" color="error100" borderRadius="sm" fontSize="sm">
                      {appeal}
                    </Text>
                  ))}
                </Box>
              </Box>
            )}
            
            {analysis.rhetorical_and_emotional_analysis.loaded_language_and_keywords && (
              <Box>
                <Text fontWeight="bold" display="block" marginBottom="xs">
                  Loaded Language & Keywords:
                </Text>
                <Box backgroundColor="white" padding="md" borderRadius="sm" maxHeight="200px" overflow="auto">
                  {objectToArray(analysis.rhetorical_and_emotional_analysis.loaded_language_and_keywords).slice(0, 20).map((keyword, i) => (
                    <Text key={i} display="inline-block" marginRight="xs" marginBottom="xs"
                          padding="xs" backgroundColor="warning20" borderRadius="sm" fontSize="xs">
                      {keyword}
                    </Text>
                  ))}
                  {objectToArray(analysis.rhetorical_and_emotional_analysis.loaded_language_and_keywords).length > 20 && (
                    <Text fontSize="xs" color="grey60" fontStyle="italic" marginTop="sm" display="block">
                      ... and {objectToArray(analysis.rhetorical_and_emotional_analysis.loaded_language_and_keywords).length - 20} more keywords
                    </Text>
                  )}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* Entity and Topic Indexing Section */}
        {analysis.entity_and_topic_indexing && (
          <Box 
            marginBottom="xl"
            padding="lg"
            backgroundColor="grey10"
            borderRadius="md"
          >
            <Text fontSize="lg" fontWeight="bold" marginBottom="md" display="block">
              🏷️ Entities & Topics
            </Text>
            
            {analysis.entity_and_topic_indexing.named_entities && (
              <Box marginBottom="md">
                <Text fontWeight="bold" display="block" marginBottom="xs">
                  Named Entities:
                </Text>
                <Box backgroundColor="white" padding="md" borderRadius="sm" maxHeight="150px" overflow="auto">
                  {objectToArray(analysis.entity_and_topic_indexing.named_entities).map((entity, i) => (
                    <Text key={i} display="inline-block" marginRight="xs" marginBottom="xs"
                          padding="xs" backgroundColor="grey20" borderRadius="sm" fontSize="xs">
                      {entity}
                    </Text>
                  ))}
                </Box>
              </Box>
            )}
            
            {analysis.entity_and_topic_indexing.key_concepts_and_themes && (
              <Box>
                <Text fontWeight="bold" display="block" marginBottom="xs">
                  Key Concepts & Themes:
                </Text>
                <Box backgroundColor="white" padding="md" borderRadius="sm" maxHeight="150px" overflow="auto">
                  {objectToArray(analysis.entity_and_topic_indexing.key_concepts_and_themes).map((theme, i) => (
                    <Text key={i} display="inline-block" marginRight="xs" marginBottom="xs"
                          padding="xs" backgroundColor="info20" borderRadius="sm" fontSize="xs">
                      {theme}
                    </Text>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* Video Metadata Section */}
        {analysis.metadata && (
          <Box 
            marginBottom="xl"
            padding="lg"
            backgroundColor="success10"
            borderRadius="md"
          >
            <Text fontSize="lg" fontWeight="bold" marginBottom="md" display="block">
              📹 Video Metadata
            </Text>
            
            <Box backgroundColor="white" padding="md" borderRadius="sm">
              {analysis.metadata.primary_language && (
                <Text marginBottom="xs" display="block">
                  <strong>Language:</strong> {analysis.metadata.primary_language}
                </Text>
              )}
              
              {analysis.metadata.video_duration && (
                <Text marginBottom="xs" display="block">
                  <strong>Duration:</strong> {Math.floor(analysis.metadata.video_duration / 60)}:{(analysis.metadata.video_duration % 60).toString().padStart(2, '0')} minutes
                </Text>
              )}
              
              {analysis.metadata.hosts_or_speakers && (
                <Text marginBottom="xs" display="block">
                  <strong>Speakers:</strong> {objectToArray(analysis.metadata.hosts_or_speakers).join(', ')}
                </Text>
              )}
              
              {analysis.metadata.processing_summary && (
                <Box marginTop="sm">
                  <Text fontWeight="bold" display="block" marginBottom="xs">Processing Summary:</Text>
                  <Text fontSize="sm" display="block">
                    Chunks: {analysis.metadata.processing_summary.successful_chunks} successful, {analysis.metadata.processing_summary.failed_chunks} failed
                  </Text>
                  <Text fontSize="sm" display="block">
                    Processing time: {Math.round(analysis.metadata.processing_summary.total_processing_time / 1000)}s
                  </Text>
                </Box>
              )}
            </Box>
          </Box>
        )}

        {/* Raw JSON Section */}
        <Box 
          padding="lg"
          backgroundColor="grey10"
          borderRadius="md"
        >
          <Text fontSize="md" fontWeight="bold" marginBottom="sm" display="block">
            📄 Raw Analysis Data
          </Text>
          <Box 
            padding="md" 
            backgroundColor="white" 
            borderRadius="sm"
            overflow="auto"
            maxHeight="400px"
          >
            <pre style={{
              fontFamily: 'monospace', 
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              margin: 0,
              wordBreak: 'break-word'
            }}>
              {JSON.stringify(analysis, null, 2)}
            </pre>
          </Box>
        </Box>
      </Box>
    );
    } catch (error) {
    return (
      <Box 
        padding="lg"
        backgroundColor="error10"
        borderRadius="md"
      >
        <Text 
          color="error100"
          fontWeight="bold"
          display="block"
          marginBottom="md"
        >
          Error displaying analysis: {error.message}
        </Text>
        <Box 
          padding="md" 
          backgroundColor="white" 
          borderRadius="sm" 
        >
          <pre style={{
            fontFamily: 'monospace', 
            fontSize: '12px',
            margin: 0
          }}>
            {JSON.stringify(analysis, null, 2)}
          </pre>
        </Box>
      </Box>
    );
  }
};

export default AnalysisDisplay; 