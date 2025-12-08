const axios = require('axios');

const BASE_URL = 'https://chatwoot.polilan.com/api/v1';
const ACCOUNT_ID = 1;
const API_ACCESS_TOKEN = 'wMcqiCtj6LeGwNDnikkxzEwn';

const headers = {
  'Content-Type': 'application/json',
  api_access_token: API_ACCESS_TOKEN,
};

/**
 * Fetches all conversations from the Chatwoot API, handling pagination.
 * @returns {Promise<Array>} A promise that resolves to an array of all conversation objects.
 */
async function getAllConversations() {
  const allConversations = [];
  let page = 1;

  console.log('Starting conversation extraction...');

  while (true) {
    const url = `${BASE_URL}/accounts/${ACCOUNT_ID}/conversations?status=all&page=${page}`;

    try {
      const response = await axios.get(url, {
        headers: headers,
        timeout: 30000,
      });

      const conversations = response.data?.data?.payload || [];

      if (conversations.length === 0) {
        console.log(`No more conversations found. Stopped at page ${page}`);
        break;
      }

      allConversations.push(...conversations);
      console.log(
        `Page ${page}: Retrieved ${conversations.length} conversations (Total: ${allConversations.length})`,
      );

      page += 1;
    } catch (error) {
      if (error.response) {
        console.error(
          `HTTP Error on page ${page}: ${error.response.status} - ${error.response.statusText}`,
        );
      } else if (error.request) {
        console.error(`Request Error on page ${page}: No response received.`);
      } else {
        console.error(`Error on page ${page}: ${error.message}`);
      }
      break;
    }
  }

  console.log(`\nTotal conversations retrieved: ${allConversations.length}`);
  return allConversations;
}

/**
 * Fetches messages for a specific conversation.
 * @param {number} conversationId - The ID of the conversation.
 * @returns {Promise<Object>} A promise that resolves to the conversation details object.
 */
async function getConversationDetails(conversationId) {
  const url = `${BASE_URL}/accounts/${ACCOUNT_ID}/conversations/${conversationId}/messages`;
  try {
    const response = await axios.get(url, {
      headers: headers,
      timeout: 30000,
    });
    return response.data;
  } catch (error) {
    if (error.response) {
      console.error(
        `HTTP Error for conversation ${conversationId}: ${error.response.status} - ${error.response.statusText}`,
      );
    } else if (error.request) {
      console.error(
        `Request Error for conversation ${conversationId}: No response received.`,
      );
    } else {
      console.error(`Error for conversation ${conversationId}: ${error.message}`);
    }
    return null;
  }
}

/**
 * Fetches details for all conversations.
 * @param {Array} conversations - An array of conversation objects.
 * @returns {Promise<Array>} A promise that resolves to an array of conversation details.
 */
async function getAllConversationDetails(conversations) {
  const allDetails = [];
  for (const conversation of conversations) {
    console.log(`Fetching details for conversation ${conversation.id}...`);
    const details = await getConversationDetails(conversation.id);
    if (details) {
      
      const messages = details.payload.map(
        ({ created_at, content, message_type, attachments }) => ({
          createdAt: created_at,
          role: message_type === 0 ? 'user' : 'assistant',
          content,
          attachments,
        }),
      );
      const leadAndMessages = {
        conversationId: conversation.id,
        phone: conversation.meta?.sender?.phone_number,
        messages: messages,
      };

      allDetails.push(leadAndMessages);
    }
  }
  return allDetails;
}

/**
 * Updates lead messages in the database.
 * @param {Array} conversationDetails - An array of conversation detail objects.
 */
async function updateLeadMessages(conversationDetails) {
  const url = 'http://192.168.2.3:8121/api/lead/operation';

  for (const conversation of conversationDetails) {
    if (conversation.phone && conversation.messages) {
      console.log(`Updating messages for phone number: ${conversation.phone}`);
      try {
        const response = await axios.post(
          url,
          {
            action: 'updateOne',
            query: {
              phoneNumber: conversation.phone,
            },
            payload: {
              $set: {
                messages: conversation.messages,
              },
            },
          },
          { headers: headers, timeout: 30000 },
        );
        console.log(
          `Successfully updated messages for ${conversation.phone}:`,
          response.data,
        );
      } catch (error) {
        if (error.response) {
          console.error(
            `HTTP Error for ${conversation.phone}: ${error.response.status} - ${error.response.statusText}`,
          );
        } else if (error.request) {
          console.error(
            `Request Error for ${conversation.phone}: No response received.`,
          );
        } else {
          console.error(`Error for ${conversation.phone}: ${error.message}`);
        }
      }
    }
  }
}

/**
 * Main function to automate the entire extraction process.
 */
async function runExtraction() {
  const conversations = await getAllConversations();
  if (conversations.length > 0) {
    const conversationDetails = await getAllConversationDetails(conversations);
    console.log(
      `\nTotal conversation details retrieved: ${conversationDetails.length}`,
    );
    if (conversationDetails.length > 0) {
      console.log('Sample of the first conversation detail retrieved:');
      console.log(JSON.stringify(conversationDetails[0], null, 2));
      await updateLeadMessages(conversationDetails);
    }
    return conversationDetails;
  }
  return [];
}

// Example of how to run the function
(async () => {
  await runExtraction();
})();

module.exports = {
  getAllConversations,
  getConversationDetails,
  getAllConversationDetails,
  runExtraction,
  updateLeadMessages,
};