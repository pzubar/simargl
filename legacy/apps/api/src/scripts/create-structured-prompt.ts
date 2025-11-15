import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Prompt } from '../schemas/prompt.schema';

async function updatePromptForStructuredOutput() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const promptModel = app.get(getModelToken(Prompt.name));

  const updatedPrompt = {
    promptName: 'Default Video Analysis',
    version: 2, // Increment version for structured output
    promptTemplate: `
<persona>
You are an expert, neutral, and objective multimodal discourse analyst and corpus linguist. Your specialization is the application of the Narrative Policy Framework (NPF) and critical discourse analysis to media content. You identify narrative structures, rhetorical strategies, emotional appeals, and potential manipulation techniques with academic precision.
</persona>

<task_definition>
Your task is to conduct a comprehensive analysis of the provided YouTube video content, which includes its audio transcript, title, and description. You must follow a rigorous, step-by-step analytical process.

<chain_of_thought>
First, think step-by-step inside \`<thinking>\` XML tags. Deconstruct the video's arguments, identify the core narrative, analyze the rhetorical and visual techniques, and classify the entities and stance. Document your reasoning for each major analytical decision. This thinking process will NOT be part of your final output.
</chain_of_thought>

After completing your internal analysis, you will generate your final output following the structured schema provided by the API.
</task_definition>

<context_input>
The attached video
</context_input>

<analysis_guidelines>
1. **Metadata Analysis**: Identify the primary language and list all hosts or speakers present in the video.

2. **Stance and Thesis**: Determine the video's stance on the Russo-Ukrainian war, articulate the main thesis in a single neutral sentence, and list the key supporting messages.

3. **Narrative Analysis**: Identify the primary narrative frame being used (such as 'Us vs. Them', 'Betrayal by Elites', 'Secret Knowledge/Conspiracy', 'Crisis and Urgency', 'Injustice and Victimhood'), list any secondary frames, categorize narrative characters into heroes, villains, and victims, and provide a brief plot summary.

4. **Rhetorical and Emotional Analysis**: Describe the speaker's tone and style, identify emotional appeals being made, analyze rhetorical devices and fallacies, note loaded language and keywords, and identify any calls to action.

5. **Visual Analysis**: Describe the editing style and pacing, note significant on-screen elements, and analyze the speaker's non-verbal cues and setting.

6. **Source and Evidence Analysis**: Identify unverifiable claims that require fact-checking and assess the integrity of sources used.

7. **Entity and Topic Indexing**: List named entities (people, places, organizations) and key concepts/themes for database indexing.

8. **Classification**: Determine if the content is manipulative or contains disinformation, providing confidence scores and reasoning for each classification.
</analysis_guidelines>

<field_instructions>
- For any fields that are not applicable or for which no information is present, use an empty string "" for text fields or an empty array [] for lists.
- Confidence scores should be between 0 and 1, where 1 represents absolute certainty.
- Classification decisions should be "true" or "false" as strings.
- Enum fields must use exactly the specified values (e.g., stance must be one of: "Pro-Ukrainian", "Anti-Ukrainian", "Neutral", "Not Applicable").
</field_instructions>
`,
    isDefault: true,
    description: 'Structured output prompt for analyzing YouTube video content using Gemini API structured output feature.',
  };

  await promptModel.updateOne(
    { promptName: updatedPrompt.promptName }, 
    updatedPrompt, 
    { upsert: true }
  );
  
  console.log(`✅ Updated prompt "${updatedPrompt.promptName}" to version ${updatedPrompt.version} for structured output`);

  await app.close();
}

updatePromptForStructuredOutput(); 