[//]: # (Prompt Template)
<persona>
You are an expert AI analyst specializing in combining and synthesizing multiple video analysis results into a single comprehensive analysis. Your task is to intelligently merge analysis results from different video chunks while maintaining analytical accuracy and coherence.
</persona>

<task_definition>
You are provided with multiple individual insights from different chunks of the same video. Your task is to combine these analyses into a single, comprehensive result that represents the overall video content.

<combination_instructions>
1. **Metadata**: Choose the most common or representative values across chunks
2. **Stance and Thesis**: Identify the overall stance and synthesize key messages from all chunks
3. **Narrative Analysis**: Combine narrative elements, ensuring all characters and frames are represented
4. **Rhetorical Analysis**: Merge emotional appeals and rhetorical devices from all chunks
5. **Visual Analysis**: Synthesize visual observations across the entire video
6. **Evidence Analysis**: Combine all unverifiable claims and assess overall source integrity
7. **Entity Indexing**: Merge all named entities and key concepts
8. **Classification**: Make overall decisions based on the combined evidence from all chunks

For arrays, deduplicate similar items and maintain comprehensiveness.
For text fields, synthesize information to represent the overall video.
For confidence scores, base them on the combined evidence across all chunks.
</combination_instructions>
</task_definition>

[//]: # (Response Schema)
{
  "type": "OBJECT",
  "properties": {
    "metadata": {
      "type": "OBJECT",
      "properties": {
        "primary_language": {
          "type": "STRING",
          "description": "Primary language detected in the video (e.g., Ukrainian, Russian, English)"
        },
        "hosts_or_speakers": {
          "type": "ARRAY",
          "items": {
            "type": "STRING"
          },
          "description": "List of identified hosts or primary speakers"
        }
      },
      "required": ["primary_language", "hosts_or_speakers"]
    },
    "stance_and_thesis": {
      "type": "OBJECT",
      "properties": {
        "russo_ukrainian_war_stance": {
          "type": "STRING",
          "enum": [
            "Pro-Ukrainian",
            "Anti-Ukrainian", 
            "Neutral",
            "Not Applicable"
          ],
          "description": "Video's stance on the Russo-Ukrainian war"
        },
        "main_thesis": {
          "type": "STRING",
          "description": "A single, neutral sentence encapsulating the video's core argument"
        },
        "key_messages": {
          "type": "ARRAY",
          "items": {
            "type": "STRING"
          },
          "description": "Main supporting points or sub-messages used to build the main thesis"
        }
      },
      "required": ["russo_ukrainian_war_stance", "main_thesis", "key_messages"]
    },
    "narrative_analysis": {
      "type": "OBJECT",
      "properties": {
        "primary_narrative_frame": {
          "type": "STRING",
          "description": "Main narrative lens (e.g., 'Us vs. Them', 'Betrayal by Elites', 'Secret Knowledge/Conspiracy', 'Crisis and Urgency', 'Injustice and Victimhood')"
        },
        "secondary_narrative_frames": {
          "type": "ARRAY",
          "items": {
            "type": "STRING"
          },
          "description": "Other significant narrative frames used"
        },
        "narrative_characters": {
          "type": "OBJECT",
          "properties": {
            "heroes": {
              "type": "ARRAY",
              "items": {
                "type": "STRING"
              },
              "description": "Entities portrayed as protagonists, saviors, or admirable figures"
            },
            "villains": {
              "type": "ARRAY",
              "items": {
                "type": "STRING"
              },
              "description": "Entities portrayed as antagonists, perpetrators of harm, or corrupt forces"
            },
            "victims": {
              "type": "ARRAY",
              "items": {
                "type": "STRING"
              },
              "description": "Entities portrayed as harmed, oppressed, or suffering"
            }
          },
          "required": ["heroes", "villains", "victims"]
        },
        "plot_summary": {
          "type": "STRING",
          "description": "Brief, neutral summary of the narrative's sequence of events"
        }
      },
      "required": [
        "primary_narrative_frame",
        "secondary_narrative_frames",
        "narrative_characters",
        "plot_summary"
      ]
    },
    "rhetorical_and_emotional_analysis": {
      "type": "OBJECT",
      "properties": {
        "speaker_tone_and_style": {
          "type": "STRING",
          "description": "Description of the speaker's tone and presentation style"
        },
        "emotional_appeals": {
          "type": "ARRAY",
          "items": {
            "type": "STRING"
          },
          "description": "Specific emotions the speaker attempts to evoke (e.g., 'Fear', 'Anger', 'Hope', 'Empathy', 'Patriotism', 'Outrage')"
        },
        "rhetorical_devices_and_fallacies": {
          "type": "STRING",
          "description": "Description of rhetorical devices and logical fallacies used"
        },
        "loaded_language_and_keywords": {
          "type": "ARRAY",
          "items": {
            "type": "STRING"
          },
          "description": "Words or phrases with strong emotional or ideological connotations"
        },
        "call_to_action": {
          "type": "OBJECT",
          "properties": {
            "cta_type": {
              "type": "STRING",
              "enum": [
                "Advocacy",
                "Donation",
                "Engagement",
                "Informational",
                "Military Support",
                "None"
              ],
              "description": "Category of the primary call to action"
            },
            "cta_text": {
              "type": "STRING",
              "description": "Specific action the audience is urged to take"
            }
          },
          "required": ["cta_type", "cta_text"]
        }
      },
      "required": [
        "speaker_tone_and_style",
        "emotional_appeals",
        "rhetorical_devices_and_fallacies",
        "loaded_language_and_keywords",
        "call_to_action"
      ]
    },
    "visual_analysis": {
      "type": "OBJECT",
      "properties": {
        "editing_style_and_pacing": {
          "type": "STRING",
          "description": "Description of video editing style (e.g., 'Fast-paced cuts for urgency', 'Slow pans with emotional music', 'Static lecture-style')"
        },
        "on_screen_elements": {
          "type": "STRING",
          "description": "Significant on-screen text, graphics, maps, charts, or memes used"
        },
        "speaker_non_verbal_cues": {
          "type": "STRING",
          "description": "Speaker's demeanor, body language, and setting"
        }
      },
      "required": [
        "editing_style_and_pacing",
        "on_screen_elements",
        "speaker_non_verbal_cues"
      ]
    },
    "source_and_evidence_analysis": {
      "type": "OBJECT",
      "properties": {
        "unverifiable_claims": {
          "type": "ARRAY",
          "items": {
            "type": "STRING"
          },
          "description": "Specific, factual-sounding claims made without verifiable evidence"
        },
        "source_integrity": {
          "type": "STRING",
          "description": "Assessment of source usage and citation quality"
        }
      },
      "required": ["unverifiable_claims", "source_integrity"]
    },
    "entity_and_topic_indexing": {
      "type": "OBJECT",
      "properties": {
        "named_entities": {
          "type": "ARRAY",
          "items": {
            "type": "STRING"
          },
          "description": "Named entities mentioned in the video (people, places, organizations)"
        },
        "key_concepts_and_themes": {
          "type": "ARRAY",
          "items": {
            "type": "STRING"
          },
          "description": "Abstract concepts and themes for database indexing"
        }
      },
      "required": ["named_entities", "key_concepts_and_themes"]
    },
    "classification": {
      "type": "OBJECT",
      "properties": {
        "is_manipulative": {
          "type": "OBJECT",
          "properties": {
            "decision": {
              "type": "STRING",
              "enum": ["true", "false"],
              "description": "Whether the content is classified as manipulative"
            },
            "confidence": {
              "type": "NUMBER",
              "minimum": 0,
              "maximum": 1,
              "description": "Confidence score for the classification"
            },
            "reasoning": {
              "type": "STRING",
              "description": "Explanation for the classification decision"
            }
          },
          "required": ["decision", "confidence", "reasoning"]
        },
        "is_disinformation": {
          "type": "OBJECT",
          "properties": {
            "decision": {
              "type": "STRING",
              "enum": ["true", "false"],
              "description": "Whether the content contains disinformation"
            },
            "confidence": {
              "type": "NUMBER",
              "minimum": 0,
              "maximum": 1,
              "description": "Confidence score for the classification"
            },
            "reasoning": {
              "type": "STRING",
              "description": "Explanation for the classification decision"
            }
          },
          "required": ["decision", "confidence", "reasoning"]
        }
      },
      "required": ["is_manipulative", "is_disinformation"]
    }
  },
  "required": [
    "metadata",
    "stance_and_thesis",
    "narrative_analysis",
    "rhetorical_and_emotional_analysis",
    "visual_analysis",
    "source_and_evidence_analysis",
    "entity_and_topic_indexing",
    "classification"
  ]
}

```