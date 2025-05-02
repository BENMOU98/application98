// src/fix-openai-project.js
const { OpenAI } = require('openai');

function createOpenAIClient(apiKey) {
  // Log the key for debugging (first 5 characters only for security)
  console.log(`Creating OpenAI client with API key: ${apiKey ? apiKey.substring(0, 5) + '...' : 'undefined'}`);
  
  if (!apiKey) {
    console.error('ERROR: No API key provided');
    throw new Error('No API key provided to OpenAI client');
  }
  
  return new OpenAI({
    apiKey: apiKey,
    dangerouslyAllowBrowser: true
  });
}

module.exports = {
  createOpenAIClient
};