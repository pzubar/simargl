/**
 * Video Analysis Response Schema for Gemini API Structured Output
 * Based on https://ai.google.dev/gemini-api/docs/structured-output
 * 
 * This schema defines the expected structure for video analysis responses
 * from the Gemini API, ensuring consistent and properly typed outputs.
 */

export const VideoAnalysisResponseSchema = {
  type: "object",
  properties: {
    metadata: {
      type: "object",
      properties: {
        primary_language: {
          type: "string",
          description: "Primary language detected in the video (e.g., Ukrainian, Russian, English)"
        },
        hosts_or_speakers: {
          type: "array",
          items: {
            type: "string"
          },
          description: "List of identified hosts or primary speakers"
        }
      },
      required: ["primary_language", "hosts_or_speakers"]
    },
    stance_and_thesis: {
      type: "object",
      properties: {
        russo_ukrainian_war_stance: {
          type: "string",
          enum: ["Pro-Ukrainian", "Anti-Ukrainian", "Neutral", "Not Applicable"],
          description: "Video's stance on the Russo-Ukrainian war"
        },
        main_thesis: {
          type: "string",
          description: "A single, neutral sentence encapsulating the video's core argument"
        },
        key_messages: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Main supporting points or sub-messages used to build the main thesis"
        }
      },
      required: ["russo_ukrainian_war_stance", "main_thesis", "key_messages"]
    },
    narrative_analysis: {
      type: "object",
      properties: {
        primary_narrative_frame: {
          type: "string",
          description: "Main narrative lens (e.g., 'Us vs. Them', 'Betrayal by Elites', 'Secret Knowledge/Conspiracy', 'Crisis and Urgency', 'Injustice and Victimhood')"
        },
        secondary_narrative_frames: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Other significant narrative frames used"
        },
        narrative_characters: {
          type: "object",
          properties: {
            heroes: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Entities portrayed as protagonists, saviors, or admirable figures"
            },
            villains: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Entities portrayed as antagonists, perpetrators of harm, or corrupt forces"
            },
            victims: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Entities portrayed as harmed, oppressed, or suffering"
            }
          },
          required: ["heroes", "villains", "victims"]
        },
        plot_summary: {
          type: "string",
          description: "Brief, neutral summary of the narrative's sequence of events"
        }
      },
      required: ["primary_narrative_frame", "secondary_narrative_frames", "narrative_characters", "plot_summary"]
    },
    rhetorical_and_emotional_analysis: {
      type: "object",
      properties: {
        speaker_tone_and_style: {
          type: "string",
          description: "Description of the speaker's tone and presentation style"
        },
        emotional_appeals: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Specific emotions the speaker attempts to evoke (e.g., 'Fear', 'Anger', 'Hope', 'Empathy', 'Patriotism', 'Outrage')"
        },
        rhetorical_devices_and_fallacies: {
          type: "string",
          description: "Description of rhetorical devices and logical fallacies used"
        },
        loaded_language_and_keywords: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Words or phrases with strong emotional or ideological connotations"
        },
        call_to_action: {
          type: "object",
          properties: {
            cta_type: {
              type: "string",
              enum: ["Advocacy", "Donation", "Engagement", "Informational", "Military Support", "None"],
              description: "Category of the primary call to action"
            },
            cta_text: {
              type: "string",
              description: "Specific action the audience is urged to take"
            }
          },
          required: ["cta_type", "cta_text"]
        }
      },
      required: ["speaker_tone_and_style", "emotional_appeals", "rhetorical_devices_and_fallacies", "loaded_language_and_keywords", "call_to_action"]
    },
    visual_analysis: {
      type: "object",
      properties: {
        editing_style_and_pacing: {
          type: "string",
          description: "Description of video editing style (e.g., 'Fast-paced cuts for urgency', 'Slow pans with emotional music', 'Static lecture-style')"
        },
        on_screen_elements: {
          type: "string",
          description: "Significant on-screen text, graphics, maps, charts, or memes used"
        },
        speaker_non_verbal_cues: {
          type: "string",
          description: "Speaker's demeanor, body language, and setting"
        }
      },
      required: ["editing_style_and_pacing", "on_screen_elements", "speaker_non_verbal_cues"]
    },
    source_and_evidence_analysis: {
      type: "object",
      properties: {
        unverifiable_claims: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Specific, factual-sounding claims made without verifiable evidence"
        },
        source_integrity: {
          type: "string",
          description: "Assessment of source usage and citation quality"
        }
      },
      required: ["unverifiable_claims", "source_integrity"]
    },
    entity_and_topic_indexing: {
      type: "object",
      properties: {
        named_entities: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Named entities mentioned in the video (people, places, organizations)"
        },
        key_concepts_and_themes: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Abstract concepts and themes for database indexing"
        }
      },
      required: ["named_entities", "key_concepts_and_themes"]
    },
    classification: {
      type: "object",
      properties: {
        is_manipulative: {
          type: "object",
          properties: {
            decision: {
              type: "string",
              enum: ["true", "false"],
              description: "Whether the content is classified as manipulative"
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Confidence score for the classification"
            },
            reasoning: {
              type: "string",
              description: "Explanation for the classification decision"
            }
          },
          required: ["decision", "confidence", "reasoning"]
        },
        is_disinformation: {
          type: "object",
          properties: {
            decision: {
              type: "string",
              enum: ["true", "false"],
              description: "Whether the content contains disinformation"
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Confidence score for the classification"
            },
            reasoning: {
              type: "string",
              description: "Explanation for the classification decision"
            }
          },
          required: ["decision", "confidence", "reasoning"]
        }
      },
      required: ["is_manipulative", "is_disinformation"]
    }
  },
  required: [
    "metadata",
    "stance_and_thesis", 
    "narrative_analysis",
    "rhetorical_and_emotional_analysis",
    "visual_analysis",
    "source_and_evidence_analysis",
    "entity_and_topic_indexing",
    "classification"
  ]
} as const;

/**
 * TypeScript interface for the video analysis response
 * Generated from the schema above for type safety
 */
export interface VideoAnalysisResponse {
  metadata: {
    primary_language: string;
    hosts_or_speakers: string[];
  };
  stance_and_thesis: {
    russo_ukrainian_war_stance: "Pro-Ukrainian" | "Anti-Ukrainian" | "Neutral" | "Not Applicable";
    main_thesis: string;
    key_messages: string[];
  };
  narrative_analysis: {
    primary_narrative_frame: string;
    secondary_narrative_frames: string[];
    narrative_characters: {
      heroes: string[];
      villains: string[];
      victims: string[];
    };
    plot_summary: string;
  };
  rhetorical_and_emotional_analysis: {
    speaker_tone_and_style: string;
    emotional_appeals: string[];
    rhetorical_devices_and_fallacies: string;
    loaded_language_and_keywords: string[];
    call_to_action: {
      cta_type: "Advocacy" | "Donation" | "Engagement" | "Informational" | "Military Support" | "None";
      cta_text: string;
    };
  };
  visual_analysis: {
    editing_style_and_pacing: string;
    on_screen_elements: string;
    speaker_non_verbal_cues: string;
  };
  source_and_evidence_analysis: {
    unverifiable_claims: string[];
    source_integrity: string;
  };
  entity_and_topic_indexing: {
    named_entities: string[];
    key_concepts_and_themes: string[];
  };
  classification: {
    is_manipulative: {
      decision: "true" | "false";
      confidence: number;
      reasoning: string;
    };
    is_disinformation: {
      decision: "true" | "false";
      confidence: number;
      reasoning: string;
    };
  };
} 