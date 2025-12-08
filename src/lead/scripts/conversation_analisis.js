const axios = require('axios');

async function getLeadByNumber(phoneNumber) {
  const url = 'http://192.168.2.3:8121/api/lead/operation';
  const payload = {
    action: 'findOne',
    query: {
      phoneNumber: phoneNumber,
    },
  };

  try {
    const response = await axios.post(url, payload);
    console.log('Lead found:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error fetching lead:', error.message);
    if (error.response) {
      console.error('Data:', error.response.data);
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
    }
    return null;
  }
}

async function getLeadsWithoutAnalysis() {
  const url = 'http://192.168.2.3:8121/api/lead/operation';
  const payload = {
    action: 'find',
    query: {
      conversationAnalysis: { $exists: false },
    },
  };

  try {
    const response = await axios.post(url, payload);
    console.log('Leads without analysis found:', response.data.length);
    return response.data;
  } catch (error) {
    console.error('Error fetching leads without analysis:', error.message);
    if (error.response) {
      console.error('Data:', error.response.data);
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
    }
    return [];
  }
}

async function getTransformedConversation(phoneNumber) {
  const lead = await getLeadByNumber(phoneNumber);
  if (!lead || !lead.messages) {
    console.log('No lead or messages found for this number.');
    return [];
  }

  const messages = lead.messages;
  return messages.map(message => {
    const formattedDate = new Date(message.createdAt * 1000).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });

    const formattedAttachments = message.attachments ? message.attachments.map(attachment => {
      return `[attachment: ${attachment.file_type}]`;
    }).join(' ') : '';

    let content = message.content || '';
    if (formattedAttachments) {
      content += ` ${formattedAttachments}`;
    }

    return {
      role: message.role,
      content: content,
      createdAt: formattedDate,
    };
  });
}

module.exports = {
    getLeadByNumber,
    getTransformedConversation,
    generateMarkdownFromConversation,
    updateConversationAnalysis,
    getLeadsWithoutAnalysis
};

async function getAnalyzeConversationPrompt(conversation) {
  const prompt = `Analyze this WhatsApp conversation between a sales assistant and a lead for a language learning app. Extract and return a JSON object with the following structure:
Usually the first message contains the text of the lead and the advertising summary he saw. 

{
  "statistics": {
    "leadResponseTime": {
      "averageMinutes": number,
      "fastestMinutes": number,
      "slowestMinutes": number
    }
  },
  "metrics": {
    "leadQuestionsCount": number,
    "assistantQuestionsCount": number,
    "questionsRatio": number,
    "leadMessagesCount": number,
    "assistantMessagesCount": number,
    "messagesRatio": number
  },
  "languageInterests": string[],
  "barriers": {
    "objections": string[],
    "concerns": string[],
    "doubts": string[]
  },
  "featuresShown": {
    "flashcards": boolean,
    "lessons": boolean,
    "conversations": boolean,
    "mobileApp": boolean
  },
  "keyQuestions": {
    "askedAboutPrice": boolean,
    "askedAboutTrial": boolean
  },
  "microConversions": {
    "downloadedApp": boolean,
    "watchedVideos": boolean,
    "openedLinks": boolean
  },
  "behavioralSignals": {
    "proactiveActions": string[],
    "hesitationPoints": string[],
    "buyingSignals": string[]
  },
  "funnelStage": "awareness" | "consideration" | "trial" | "purchase",
  "purchaseProbability": "very_low" | "low" | "medium" | "high" | "very_high",
  "insights": {
    "opinion": string,
    "recommendations": string,
    "nextSteps": string
  }
}

Analysis Guidelines:
- Calculate response times based on message timestamps in minutes
- Questions are defined as sentences ending with "?" or clear requests for information
- languageInterests: Extract any languages the lead mentions wanting to learn
- Objections: Explicit pushback or negative statements about the product/service
- Concerns: Worries or hesitations that aren't direct objections (pricing worries, payment methods, etc.)
- Doubts: Confusion or lack of understanding about how the product works
- proactiveActions: Things the lead did without being asked (downloaded app, clicked links, watched videos)
- hesitationPoints: Moments where the lead seemed uncertain, went silent, or showed resistance
- buyingSignals: Explicit statements or behaviors indicating readiness to purchase
- For purchaseProbability, consider: engagement level, barriers present, micro-conversions completed, and explicit buying signals
- funnelStage should reflect current position: awareness (just learned about product), consideration (exploring features/pricing), trial (testing the product), purchase (ready to buy or negotiating)
- nextSteps should be numbered, specific, and actionable recommendations for the sales assistant
- If conversation is incomplete or assistant hasn't responded to lead's last message, flag this in insights
- Extract all insights in English, even if the conversation is in another language

Important: 
- If timestamps are not provided, omit all time-based metrics
- If conversation is less than 3 exchanges, set purchaseProbability to "very_low" by default
- Mark any fields as null or empty arrays if insufficient data exists rather than guessing
- Translate all extracted content to English for consistency

Return ONLY the JSON object, no additional text or markdown formatting.

Conversation:
${conversation}
    
}`;

return prompt;
}

async function analyzeConversationWithAI(prompt) {
  const url = 'http://localhost:3330/api/ai-services/gemini/chat';
  const payload = {
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    model: {quality: 'balanced'},
    returnJson: true,
  };

  try {
    const response = await axios.post(url, payload);
    console.log('Analysis result:', response.data.content);
    return response.data.content;
  } catch (error) {
    console.error('Error analyzing conversation:', error.message);
    if (error.response) {
      console.error('Data:', error.response.data);
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
    }
    return null;
  }
}

function generateMarkdownFromConversation(conversation) {
  let markdown = '';
  for (const message of conversation) {
    markdown += `**Role:** ${message.role}\n`;
    markdown += `**Date:** ${message.createdAt}\n`;
    markdown += `**Content:**\n${message.content}\n\n`;
    markdown += '---\n\n';
  }
  return markdown;
}

// Example usage:
async function main() {
  const leads = await getLeadsWithoutAnalysis();
  console.log(`Total leads without analysis: ${leads.length}`);
  for (const lead of leads) {
    const phoneNumber = lead.phoneNumber;
    console.log(`Processing lead: ${phoneNumber}`);
    const formattedConversation = await getTransformedConversation(phoneNumber);
    if (formattedConversation.length === 0) {
      console.log(`No conversation found for ${phoneNumber}, skipping.`);
      continue;
    }
    const markdown = generateMarkdownFromConversation(formattedConversation);
    const analysisPrompt = await getAnalyzeConversationPrompt(markdown);
    const conversationAnalysis = await analyzeConversationWithAI(analysisPrompt);

    if (conversationAnalysis) {
      await updateConversationAnalysis(phoneNumber, conversationAnalysis);
    }
    console.log(`Finished processing lead: ${phoneNumber}`);
  }
}

main();
async function updateConversationAnalysis(phoneNumber, conversationAnalysis) {
  const url = 'http://192.168.2.3:8121/api/lead/operation';
  const payload = {
    action: 'updateOne',
    query: {
      phoneNumber: phoneNumber,
    },
    payload: {
      $set: {
        conversationAnalysis: conversationAnalysis,
      },
    },
  };

  try {
    const response = await axios.post(url, payload, { timeout: 30000 });
    console.log(
      `Successfully updated conversation analysis for ${phoneNumber}:`,
      response.data,
    );
  } catch (error) {
    if (error.response) {
      console.error(
        `HTTP Error for ${phoneNumber}: ${error.response.status} - ${error.response.statusText}`,
      );
    } else if (error.request) {
      console.error(
        `Request Error for ${phoneNumber}: No response received.`,
      );
    } else {
      console.error(`Error for ${phoneNumber}: ${error.message}`);
    }
  }
}