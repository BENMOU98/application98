// src/recipe-helper.js
//
// This module handles recipe detection and integration with WP Recipe Maker

const axios = require('axios');
const wpRecipeMaker = require('./wp-recipe-maker');
const recipeFormatter = require('./recipe-formatter');
const { createOpenAIClient } = require('./fix-openai-project');

/**
 * Determine if a keyword should have a recipe added
 * @param {string} keyword - The keyword to check
 * @param {Object} recipeConfig - Recipe configuration
 * @returns {boolean} - True if recipe should be added
 */
function shouldAddRecipe(keyword, recipeConfig) {
  console.log(`=== DEBUGGING SHOULD ADD RECIPE ===`);
  console.log(`Checking if recipe should be added for keyword: ${keyword}`);
  console.log(`Recipe config:`, JSON.stringify(recipeConfig, null, 2));
  
  if (!recipeConfig || !recipeConfig.enabled) {
    console.log(`Recipe integration not enabled, returning false`);
    return false;
  }
  
  // If addToAllKeywords is enabled, always return true
  if (recipeConfig.addToAllKeywords) {
    console.log(`addToAllKeywords is enabled, returning true`);
    return true;
  }
  
  // Convert keywords list to array and normalize
  const recipeKeywords = recipeConfig.keywords
    .split(',')
    .map(k => k.trim().toLowerCase());
  
  console.log(`Recipe keywords:`, recipeKeywords);
  
  // Check if any of the recipe keywords are in the article keyword
  const keywordLower = keyword.toLowerCase();
  
  const result = recipeKeywords.some(recipeKeyword => 
    keywordLower.includes(recipeKeyword)
  );
  
  console.log(`Keyword match result: ${result}`);
  return result;
}

/**
 * Generate recipe data using OpenAI
 * @param {Object} openai - OpenAI client instance
 * @param {Object} openaiConfig - OpenAI API configuration
 * @param {string} keyword - Keyword to generate recipe for
 * @returns {Object|null} Recipe data object or null if generation fails
 */
async function generateRecipeData(openai, openaiConfig, keyword) {
  try {
    console.log(`Generating recipe data for keyword: ${keyword}`);
    
    // Check if custom recipe prompt is enabled and available
    let promptTemplate = '';

    // Enhanced check for custom recipe prompt in different paths
    if (openaiConfig.prompts && openaiConfig.prompts.useCustomRecipePrompt && openaiConfig.prompts.recipePromptTemplate) {
      console.log('Using custom recipe prompt template from configuration (openaiConfig.prompts)');
      promptTemplate = openaiConfig.prompts.recipePromptTemplate;
    } else if (openaiConfig.useCustomRecipePrompt && openaiConfig.recipePromptTemplate) {
      console.log('Using custom recipe prompt template from configuration (direct openaiConfig properties)');
      promptTemplate = openaiConfig.recipePromptTemplate;
    } else {
      console.log('Using default recipe prompt template');
      promptTemplate = `Generate a complete recipe related to "{keyword}".

Format the response as a structured JSON object with the following fields:
{
  "title": "Recipe title",
  "description": "Brief description of the dish",
  "ingredients": ["ingredient 1", "ingredient 2", ...],
  "instructions": ["step 1", "step 2", ...],
  "prep_time": "XX mins",
  "cook_time": "XX mins",
  "yield": "X servings",
  "notes": ["note 1", "note 2", ...],
  "nutrition_info": {
    "Calories": "XXX kcal",
    "Protein": "XXg",
    "Carbs": "XXg",
    "Fat": "XXg"
  }
}`;
    }
    
    // Replace the keyword in the prompt template
    const prompt = promptTemplate.replace(/\{keyword\}/g, keyword);
    
    console.log('Sending recipe generation request to OpenAI...');
    console.log('Prompt first 100 chars:', prompt.substring(0, 100) + '...');
    
    // Call API with force JSON response format if possible
    const options = {
      model: openaiConfig.model,
      messages: [
        { 
          role: "system", 
          content: "You are a professional chef specializing in creating structured recipe data in perfect JSON format. You only output valid JSON."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.7, // Slightly reduced from default to ensure formatting consistency
      max_tokens: Math.min(2000, openaiConfig.maxTokens)
    };
    
    // Add response_format if the model supports it (GPT-4 and newer)
    if (openaiConfig.model.includes('gpt-4') || openaiConfig.model.includes('gpt-3.5-turbo')) {
      options.response_format = { type: "json_object" };
    }
    
    const response = await openai.chat.completions.create(options);
    
    const content = response.choices[0].message.content;
    console.log('Received response from OpenAI');
    
    // Extract JSON from response
    let recipeData;
    try {
      // Try direct parsing first
      try {
        recipeData = JSON.parse(content);
        console.log('Successfully parsed JSON response directly');
      } catch (directParseError) {
        // If direct parsing fails, try to extract JSON object from the text
        console.log('Direct JSON parsing failed, trying to extract JSON from text...');
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          recipeData = JSON.parse(jsonMatch[0]);
          console.log('Successfully extracted and parsed JSON from text');
        } else {
          throw new Error('No JSON found in response');
        }
      }
    } catch (jsonError) {
      console.error('Error parsing recipe JSON:', jsonError);
      console.log('Raw response (first 200 chars):', content.substring(0, 200));
      
      // Last resort: create a minimal valid recipe object
      console.log('Creating minimal valid recipe object as fallback');
      return {
        title: `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} Recipe`,
        description: `A delicious ${keyword} recipe.`,
        ingredients: ["Please check the recipe description for ingredients"],
        instructions: ["Please follow the instructions in the article"],
        prep_time: "30 mins",
        cook_time: "30 mins",
        yield: "4 servings",
        notes: ["Recipe generated as fallback"],
        nutrition_info: {
          Calories: "N/A",
          Protein: "N/A",
          Carbs: "N/A",
          Fat: "N/A"
        }
      };
    }
    
    // Validate the recipe data
    if (!recipeData.title || !recipeData.ingredients || !recipeData.instructions) {
      console.error('Recipe data is missing required fields');
      
      // Add missing fields with defaults
      if (!recipeData.title) recipeData.title = `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} Recipe`;
      if (!recipeData.ingredients) recipeData.ingredients = ["Please check the recipe description for ingredients"];
      if (!recipeData.instructions) recipeData.instructions = ["Please follow the instructions in the article"];
      if (!recipeData.description) recipeData.description = `A delicious ${keyword} recipe.`;
      if (!recipeData.prep_time) recipeData.prep_time = "30 mins";
      if (!recipeData.cook_time) recipeData.cook_time = "30 mins";
      if (!recipeData.yield) recipeData.yield = "4 servings";
    }
    
    console.log(`Successfully generated recipe: "${recipeData.title}"`);
    console.log(`Ingredients: ${recipeData.ingredients.length}, Instructions: ${recipeData.instructions.length}`);
    
    // Apply custom formatting if configured
    if (openaiConfig.wpRecipeMaker && openaiConfig.wpRecipeMaker.customRecipeFormat &&
        openaiConfig.wpRecipeMaker.customRecipeFormat.enabled) {
      
      if (openaiConfig.wpRecipeMaker.customRecipeFormat.useFixedTemplate) {
        // Use completely fixed template (for maximum control)
        recipeData = recipeFormatter.useFixedTemplate(recipeData);
      } else {
        // Use custom template with dynamic content
        recipeData = recipeFormatter.formatRecipeData(recipeData, openaiConfig.wpRecipeMaker.customRecipeFormat);
      }
    }
    
    return recipeData;
  } catch (error) {
    console.error('Error generating recipe data:', error);
    
    // Create minimal valid recipe on error
    return {
      title: `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} Recipe`,
      description: `A delicious ${keyword} recipe.`,
      ingredients: ["Please check the recipe description for ingredients"],
      instructions: ["Please follow the instructions in the article"],
      prep_time: "30 mins",
      cook_time: "30 mins",
      yield: "4 servings",
      notes: ["Recipe generated as fallback due to an error"],
      nutrition_info: {
        Calories: "N/A",
        Protein: "N/A",
        Carbs: "N/A",
        Fat: "N/A"
      },
      cuisine: ["International"],
      course: ["Main Dish"],
      difficulty: "Medium",
      keywords: [keyword]
    };
  }
}

/**
 * Add recipe to a WordPress post using WP Recipe Maker integration
 * @param {Object} wordpressConfig - WordPress API configuration
 * @param {Object} recipeConfig - Recipe configuration
 * @param {Object} recipeData - Recipe data
 * @param {number} postId - WordPress post ID
 * @returns {Object} Recipe creation result
 */
async function addRecipeToPost(wordpressConfig, recipeConfig, recipeData, postId) {
  try {
    console.log(`=== DEBUGGING WP RECIPE MAKER INTEGRATION ===`);
    console.log(`Adding recipe to post ID: ${postId}`);
    console.log(`Full Recipe Config:`, JSON.stringify(recipeConfig, null, 2));
    console.log(`Recipe config enabled:`, recipeConfig.enabled);
    console.log(`Recipe config useWPRM:`, recipeConfig.useWPRM);
    console.log(`Recipe config addToAllKeywords:`, recipeConfig.addToAllKeywords);
    
    // FIXED: Ensure we preserve the original recipe data
    if (recipeData && recipeConfig.useWPRM) {
      // Make sure we have the original ingredients and instructions saved
      if (!recipeData._originalIngredients) {
        recipeData._originalIngredients = [...recipeData.ingredients];
      }
      
      if (!recipeData._originalInstructions) {
        recipeData._originalInstructions = [...recipeData.instructions];
      }
      
      // Set custom formatting flags
      recipeData._customFormatted = true;
      
      // Get the template from the global config
      try {
        const fs = require('fs');
        const path = require('path');
        const configPath = path.join(__dirname, '../data/config.json');
        const configData = fs.readFileSync(configPath, 'utf8');
        const globalConfig = JSON.parse(configData);
        
        if (globalConfig.wpRecipeMaker && 
            globalConfig.wpRecipeMaker.customRecipeFormat && 
            globalConfig.wpRecipeMaker.customRecipeFormat.enabled &&
            globalConfig.wpRecipeMaker.customRecipeFormat.customTemplate) {
          
          // Instead of directly using the template, we'll create a dynamic one
          // based on the actual recipe data
          const recipeFormatter = require('./recipe-formatter');
          
          // Check if we should use the fixed template approach (but with the recipe's data)
          if (globalConfig.wpRecipeMaker.customRecipeFormat.useFixedTemplate) {
            // Use our fixed implementation that preserves recipe data
            let formattedRecipe = recipeFormatter.useFixedTemplate(recipeData);
            recipeData._customTemplate = formattedRecipe._customTemplate;
          } else {
            // Use the custom template with the recipe's data
            let formattedRecipe = recipeFormatter.formatRecipeData(
                recipeData, 
                globalConfig.wpRecipeMaker.customRecipeFormat
            );
            recipeData._customTemplate = formattedRecipe._customTemplate;
          }
          
          console.log('Applied dynamic custom template for recipe');
        } else {
          // Create a dynamic template based on actual recipe data
          const ingredientsList = recipeData._originalIngredients.map(ingredient => `* ${ingredient}`).join('\n');
          const instructionsList = recipeData._originalInstructions.map((instruction, index) => 
            `Step ${index + 1}: ${instruction}`
          ).join('\n\n');
          
          recipeData._customTemplate = `**Ingredients**\n**  **\n${ingredientsList}\n\n**Instructions**\n** **\n${instructionsList}`;
          console.log('Created dynamic template based on recipe data');
        }
      } catch (configError) {
        console.error('Error reading config for template:', configError.message);
        // Create a dynamic template based on the recipe data instead of using fallback
        const ingredientsList = recipeData._originalIngredients.map(ingredient => `* ${ingredient}`).join('\n');
        const instructionsList = recipeData._originalInstructions.map((instruction, index) => 
          `Step ${index + 1}: ${instruction}`
        ).join('\n\n');
        
        recipeData._customTemplate = `**Ingredients**\n**  **\n${ingredientsList}\n\n**Instructions**\n** **\n${instructionsList}`;
        console.log('Created dynamic template based on recipe data due to error');
      }
    }
    
    // Use the WP Recipe Maker integration module
    if (recipeConfig.useWPRM) {
      console.log('Using WP Recipe Maker integration for recipe addition');
      const result = await wpRecipeMaker.addRecipeToPost(
        wordpressConfig, 
        recipeConfig, 
        recipeData, 
        postId
      );
      
      // If we get a successful result with a recipe ID, add the shortcode to the post
      if (result.success && result.recipeId) {
        await addRecipeShortcodeToPost(wordpressConfig, postId, result.recipeId);
      }
      
      return result;
    } else {
      // Fall back to legacy recipe integration method
      return addLegacyRecipeToPost(wordpressConfig, recipeConfig, recipeData, postId);
    }
    
    // Use the WP Recipe Maker integration module
    if (recipeConfig.useWPRM) {
      console.log('Using WP Recipe Maker integration for recipe addition');
      const result = await wpRecipeMaker.addRecipeToPost(
        wordpressConfig, 
        recipeConfig, 
        recipeData, 
        postId
      );
      
      // If we get a successful result with a recipe ID, add the shortcode to the post
      if (result.success && result.recipeId) {
        await addRecipeShortcodeToPost(wordpressConfig, postId, result.recipeId);
      }
      
      return result;
    } else {
      // Fall back to legacy recipe integration method
      return addLegacyRecipeToPost(wordpressConfig, recipeConfig, recipeData, postId);
    }
  } catch (error) {
    console.error('Error adding recipe to post:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Add recipe shortcode to post content
 * @param {Object} wordpressConfig - WordPress API configuration
 * @param {number} postId - WordPress post ID
 * @param {number} recipeId - WP Recipe Maker recipe ID
 */
async function addRecipeShortcodeToPost(wordpressConfig, postId, recipeId) {
  try {
    console.log(`Adding WPRM shortcode for recipe ID ${recipeId} to post ID ${postId}`);
    
    // Create authentication headers
    const authString = `${wordpressConfig.username}:${wordpressConfig.password}`;
    const encodedAuth = Buffer.from(authString).toString('base64');
    
    // Get the current post content
    const postResponse = await axios.get(
      `${wordpressConfig.apiUrl}/posts/${postId}`,
      {
        headers: {
          'Authorization': `Basic ${encodedAuth}`
        }
      }
    );
    
    // Check which content property exists and use it
    let currentContent;
    if (postResponse.data.content && postResponse.data.content.raw) {
      currentContent = postResponse.data.content.raw;
      console.log('Using content.raw property from WP API response');
    } else if (postResponse.data.content && postResponse.data.content.rendered) {
      // Remove HTML entities from rendered content
      currentContent = postResponse.data.content.rendered
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&');
      console.log('Using decoded content.rendered property from WP API response');
    } else if (typeof postResponse.data.content === 'string') {
      currentContent = postResponse.data.content;
      console.log('Using content string property from WP API response');
    } else {
      console.error('Unable to determine content format from WordPress API');
      currentContent = '';
    }
    
    // Create the shortcode
    const shortcode = `[wprm-recipe id="${recipeId}"]`;
    
    // Always add the recipe at the end of the content
    const newContent = currentContent.trim() + `\n\n<!-- Recipe -->\n${shortcode}\n\n`;
    
    console.log(`Updating post with shortcode: ${shortcode}`);
    
    // Update the post with the new content
    const updateResponse = await axios.put(
      `${wordpressConfig.apiUrl}/posts/${postId}`,
      {
        content: newContent
      },
      {
        headers: {
          'Authorization': `Basic ${encodedAuth}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (updateResponse.status === 200) {
      console.log(`✓ Recipe shortcode added to post ID: ${postId}`);
      return true;
    } else {
      console.log(`Unexpected response status: ${updateResponse.status}`);
      return false;
    }
  } catch (error) {
    console.error('Error adding recipe shortcode to post:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return false;
  }
}

/**
 * Legacy method to add recipe to post
 * @param {Object} wordpressConfig - WordPress API configuration
 * @param {Object} recipeConfig - Recipe configuration
 * @param {Object} recipeData - Recipe data
 * @param {number} postId - WordPress post ID
 * @returns {Object} Recipe creation result
 */
async function addLegacyRecipeToPost(wordpressConfig, recipeConfig, recipeData, postId) {
  try {
    console.log('Using legacy recipe integration method');
    
    // Create authentication headers
    const authString = `${wordpressConfig.username}:${wordpressConfig.password}`;
    const encodedAuth = Buffer.from(authString).toString('base64');
    
    // Format recipe content in WordPress blocks format
    const recipeContent = `<!-- wp:paragraph -->
<p>${recipeData.description || ""}</p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2>Ingredients</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul>
${recipeData.ingredients.map(ing => `<li>${ing}</li>`).join('\n')}
</ul>
<!-- /wp:list -->

<!-- wp:heading -->
<h2>Instructions</h2>
<!-- /wp:heading -->

<!-- wp:list {"ordered":true} -->
<ol>
${recipeData.instructions.map(step => `<li>${step}</li>`).join('\n')}
</ol>
<!-- /wp:list -->`;
    
    // Get current post content
    const postResponse = await axios.get(
      `${wordpressConfig.apiUrl}/posts/${postId}`,
      {
        headers: {
          'Authorization': `Basic ${encodedAuth}`
        }
      }
    );
    
    // Check which content property exists and use it
    let currentContent;
    if (postResponse.data.content && postResponse.data.content.raw) {
      currentContent = postResponse.data.content.raw;
    } else if (postResponse.data.content && postResponse.data.content.rendered) {
      // Remove HTML entities from rendered content
      currentContent = postResponse.data.content.rendered
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&');
    } else if (typeof postResponse.data.content === 'string') {
      currentContent = postResponse.data.content;
    } else {
      console.error('Unable to determine content format from WordPress API');
      currentContent = '';
    }
    
    // Find a good place to insert the recipe (after first heading)
    let newContent = currentContent;
    const h2Match = currentContent.match(/<h2[^>]*>.*?<\/h2>/i);
    
    if (h2Match && h2Match.index !== undefined) {
      // Find the end of the first section
      const h2EndIndex = currentContent.indexOf('</h2>', h2Match.index) + 5;
      const nextH2Index = currentContent.indexOf('<h2', h2EndIndex);
      
      if (nextH2Index !== -1) {
        // Insert before the second h2
        newContent = currentContent.substring(0, nextH2Index) + 
                     `\n\n<!-- wp:heading -->\n<h2>Recipe: ${recipeData.title}</h2>\n<!-- /wp:heading -->\n\n` + 
                     recipeContent + 
                     '\n\n' + 
                     currentContent.substring(nextH2Index);
      } else {
        // If there's only one h2, add at the end
        newContent = currentContent + 
                     `\n\n<!-- wp:heading -->\n<h2>Recipe: ${recipeData.title}</h2>\n<!-- /wp:heading -->\n\n` + 
                     recipeContent;
      }
    } else {
      // If no h2 found, add to the end
      newContent = currentContent + 
                   `\n\n<!-- wp:heading -->\n<h2>Recipe: ${recipeData.title}</h2>\n<!-- /wp:heading -->\n\n` + 
                   recipeContent;
    }
    
    // Update the post with the new content
    await axios.put(
      `${wordpressConfig.apiUrl}/posts/${postId}`,
      {
        content: newContent
      },
      {
        headers: {
          'Authorization': `Basic ${encodedAuth}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`✓ Recipe content added directly to post ID: ${postId}`);
    
    return {
      success: true,
      recipeAdded: true
    };
  } catch (error) {
    console.error('Error in legacy recipe addition:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Add WP Recipe Maker recipe to a post
 * Helper function for the wprm-integration-test.js script
 * @param {Object} wpConfig - WordPress configuration
 * @param {Object} wprmConfig - WP Recipe Maker configuration
 * @param {Object} recipeData - Recipe data to add
 * @param {number} postId - WordPress post ID
 * @returns {Object} Recipe API response
 */
async function addWPRMRecipeToPost(wpConfig, wprmConfig, recipeData, postId) {
  try {
    return await wpRecipeMaker.addRecipeToPost(wpConfig, wprmConfig, recipeData, postId);
  } catch (error) {
    console.error('Error adding WPRM recipe to post:', error.message);
    throw error;
  }
}

/**
 * Test the WP Recipe Maker API connection
 * @param {Object} wpConfig - WordPress configuration
 * @returns {Object} Test result
 */
async function testWPRMApiConnection(wpConfig) {
  return await wpRecipeMaker.testWPRMApiConnection(wpConfig);
}

/**
 * Extract servings from yield string
 * @param {string} yieldString - Yield string (e.g., "4 servings", "4-6 people")
 * @returns {number} Number of servings
 */
function extractServings(yieldString) {
  if (!yieldString || yieldString === 'N/A') return 4; // Default to 4 servings
  
  // Handle range (e.g., "4-6 servings")
  const rangeMatch = yieldString.match(/(\d+)\s*-\s*(\d+)/);
  if (rangeMatch) {
    // Take the average of the range
    return Math.round((parseInt(rangeMatch[1], 10) + parseInt(rangeMatch[2], 10)) / 2);
  }
  
  // Handle single number
  const numberMatch = yieldString.match(/(\d+)/);
  return numberMatch ? parseInt(numberMatch[1], 10) : 4;
}

/**
 * Process instructions to create proper step groups for WP Recipe Maker
 * @param {Array} instructions - Original recipe instructions
 * @returns {Array} - Formatted instruction groups for WP Recipe Maker
 */
function processInstructionsIntoGroups(instructions) {
  // Group instructions by step headers
  const groupedInstructions = [];
  let currentGroup = null;
  let groupInstructions = [];
  
  for (const instruction of instructions) {
    // Check if this is a step header (starts with "Step" or contains a colon)
    if (instruction.startsWith('Step') || instruction.includes(':')) {
      // If we have a current group, add it to the groupedInstructions
      if (currentGroup && groupInstructions.length > 0) {
        groupedInstructions.push({
          name: currentGroup,
          instructions: [...groupInstructions]
        });
        groupInstructions = [];
      }
      
      // Set the new group header
      currentGroup = instruction;
    } else {
      // This is a regular instruction, add it to the current group
      groupInstructions.push(instruction);
    }
  }
  
  // Don't forget to add the last group
  if (currentGroup && groupInstructions.length > 0) {
    groupedInstructions.push({
      name: currentGroup,
      instructions: [...groupInstructions]
    });
  }
  
  // If no groups were created, create a default group
  if (groupedInstructions.length === 0) {
    groupedInstructions.push({
      name: "Instructions",
      instructions: instructions
    });
  }
  
  // Format the instructions for WP Recipe Maker
  return groupedInstructions.map((group, groupIndex) => {
    return {
      name: group.name,
      uid: groupIndex,
      instructions: group.instructions.map((instruction, index) => {
        return {
          uid: index,
          name: "", // Step name within group (usually empty)
          text: `<p>${instruction}</p>`,
          image: 0,
          ingredients: []
        };
      })
    };
  });
}

module.exports = {
  shouldAddRecipe,
  generateRecipeData,
  addRecipeToPost,
  addWPRMRecipeToPost,
  testWPRMApiConnection,
  extractServings,
  processInstructionsIntoGroups
};