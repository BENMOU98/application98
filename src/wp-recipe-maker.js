// src/wp-recipe-maker.js
//
// This module handles integration with the WP Recipe Maker plugin using WordPress native API

const axios = require('axios');
const url = require('url');

/**
 * Add recipe to a post via WordPress API for WP Recipe Maker
 * @param {Object} wpConfig - WordPress configuration
 * @param {Object} wprmConfig - WP Recipe Maker configuration
 * @param {Object} recipeData - Recipe data to add
 * @param {number} postId - WordPress post ID
 * @returns {Object} Recipe API response
 */
async function addRecipeToPost(wpConfig, wprmConfig, recipeData, postId) {
  try {
    if (!wpConfig || !wpConfig.apiUrl || !recipeData || !postId) {
      throw new Error('Missing required parameters for adding recipe to post');
    }
    
    console.log(`Adding WPRM recipe "${recipeData.title}" to post ID: ${postId}`);
    
    // Create auth header
    const authString = `${wpConfig.username}:${wpConfig.password}`;
    const encodedAuth = Buffer.from(authString).toString('base64');
    
    // Parse the API URL
    const parsedUrl = url.parse(wpConfig.apiUrl);
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
    
    // Use the working endpoint
    const endpoint = '/wp-json/wp/v2/wprm_recipe';
    
    // Extract timing info
    const prepTimeMinutes = extractTimeMinutes(recipeData.prep_time);
    const cookTimeMinutes = extractTimeMinutes(recipeData.cook_time);
    const totalTimeMinutes = prepTimeMinutes + cookTimeMinutes;
    
    // Check if recipe data has custom formatting
    let formattedIngredients = [];
    let formattedInstructions = [];

    if (recipeData._customFormatted && recipeData._customTemplate) {
        console.log('Using custom template format for recipe');
        
        // FIXED: Use the original ingredients and instructions instead of fixed template
        // If we have original data, use it rather than parsing from template
        if (recipeData._originalIngredients && recipeData._originalIngredients.length > 0) {
            console.log('Using original ingredients from recipe data');
            formattedIngredients = [{
                name: "",
                uid: -1,
                ingredients: recipeData._originalIngredients.map((ingredient, index) => {
                  return {
                    uid: index,
                    amount: "",
                    unit: "",
                    name: ingredient,
                    notes: ""
                  };
                })
            }];
        } else {
            // Fallback to template parsing if no original data
            // Keep your original template parsing code
            const template = recipeData._customTemplate;
            
            // Split by sections
            const ingredientsPart = template.split('**Instructions**')[0] || "";
            const instructionsPart = template.split('**Instructions**')[1] || "";
            
            // Process ingredients - extract individual ingredients from bullet points
            const ingredientLines = ingredientsPart
              .split('\n')
              .filter(line => line.trim().startsWith('*'))
              .map(line => line.replace(/^\s*\*\s*/, '').trim());
            
            // Create formatted ingredients
            if (ingredientLines.length > 0) {
              formattedIngredients = [{
                name: "",
                uid: -1,
                ingredients: ingredientLines.map((ingredient, idx) => ({
                  uid: idx,
                  amount: "",
                  unit: "",
                  name: ingredient,
                  notes: ""
                }))
              }];
            } else {
              // Fallback to single ingredient with full text
              formattedIngredients = [{
                name: "",
                uid: -1,
                ingredients: [{
                  uid: 0,
                  amount: "",
                  unit: "",
                  name: ingredientsPart.trim(),
                  notes: ""
                }]
              }];
            }
        }
        
        // FIXED: Use the original instructions with proper step formatting
        if (recipeData._originalInstructions && recipeData._originalInstructions.length > 0) {
            console.log('Using original instructions from recipe data with proper step formatting');
            
            // Group instructions by step headers
            const groupedInstructions = [];
            let currentGroup = null;
            let groupInstructions = [];
            
            for (const instruction of recipeData._originalInstructions) {
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
            
            // If no groups were created, create default groups
            if (groupedInstructions.length === 0) {
                // If no step headers were found, try to create reasonable groups
                // by splitting instructions into groups of 2-3
                const stepSize = 2;
                for (let i = 0; i < recipeData._originalInstructions.length; i += stepSize) {
                    const stepNum = Math.floor(i / stepSize) + 1;
                    const stepInstructions = recipeData._originalInstructions.slice(i, i + stepSize);
                    groupedInstructions.push({
                        name: `Step ${stepNum}: ${getStepTitle(stepNum, stepInstructions[0])}`,
                        instructions: stepInstructions
                    });
                }
            }
            
            // Format the instructions for WP Recipe Maker
            formattedInstructions = groupedInstructions.map((group, groupIndex) => {
                return {
                    name: group.name,
                    uid: groupIndex,
                    instructions: group.instructions.map((instruction, index) => {
                        // Create the instruction with sequential numbering
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
        } else {
            // Fallback to template parsing if no original data
            // Keep your original template parsing code
            const template = recipeData._customTemplate;
            const instructionsPart = template.split('**Instructions**')[1] || "";
            
            // Process instructions - look for step titles and numbered steps
            const instructionLines = instructionsPart
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0);
            
            // Create formatted instructions
            const processedInstructions = [];
            let currentStep = null;
            
            for (const line of instructionLines) {
              // Check if this is a step title (starts with ** and ends with **)
              if (line.startsWith('**') && line.endsWith('**')) {
                // Add as a new instruction
                processedInstructions.push({
                  uid: processedInstructions.length,
                  name: line.replace(/^\*\*|\*\*$/g, ''),
                  text: `<p><strong>${line.replace(/^\*\*|\*\*$/g, '')}</strong></p>`,
                  image: 0,
                  ingredients: []
                });
                currentStep = line.replace(/^\*\*|\*\*$/g, '');
              }
              // Check if this is a numbered step (starts with a number followed by - or .)
              else if (line.match(/^\d+[-\.]/)) {
                const stepText = line.replace(/^\d+[-\.\s]+/, '').trim();
                processedInstructions.push({
                  uid: processedInstructions.length,
                  name: currentStep ? `${currentStep} - Step` : "",
                  text: `<p>${stepText}</p>`,
                  image: 0,
                  ingredients: []
                });
              }
            }
            
            // Use processed instructions if we found any, otherwise use the whole text
            if (processedInstructions.length > 0) {
              formattedInstructions = [{
                name: "",
                uid: -1,
                instructions: processedInstructions
              }];
            } else {
              // Fallback to single instruction with full text
              formattedInstructions = [{
                name: "",
                uid: -1,
                instructions: [{
                  uid: 0,
                  name: "",
                  text: instructionsPart.trim(),
                  image: 0,
                  ingredients: []
                }]
              }];
            }
        }
    } else {
      console.log('Using standard format for recipe ingredients and instructions');
      
      // Format ingredients properly for WP Recipe Maker
      formattedIngredients = [{
        name: "",
        uid: -1,
        ingredients: (recipeData._originalIngredients || recipeData.ingredients).map((ingredient, index) => {
          return {
            uid: index,
            amount: "",
            unit: "",
            name: ingredient,
            notes: ""
          };
        })
      }];
      
      // Format instructions properly for WP Recipe Maker
      formattedInstructions = [{
        name: "",
        uid: -1,
        instructions: (recipeData._originalInstructions || recipeData.instructions).map((instruction, index) => {
          return {
            uid: index,
            name: "",
            text: `<p>${instruction}</p>`,
            image: 0,
            ingredients: []
          };
        })
      }];
    }
    
    // Format recipe for WP Recipe Maker
    const wprmRecipeData = {
      title: recipeData.title,
      status: 'publish',
      content: recipeData.description || 'A delicious recipe.',
      
      // Recipe data goes in recipe object, not meta
      recipe: {
        // Basic recipe info
        parent_post_id: postId,
        image_id: 0,
        name: recipeData.title,
        summary: recipeData.description || "",
        
        // Servings
        servings: extractServings(recipeData.yield),
        servings_unit: "servings",
        
        // Times
        prep_time: prepTimeMinutes,
        cook_time: cookTimeMinutes,
        total_time: totalTimeMinutes,
        
        // Notes
        notes: Array.isArray(recipeData.notes) ? recipeData.notes.join('\n\n') : (recipeData.notes || ''),
        
        // Use the formatted ingredients and instructions
        ingredients: formattedIngredients,
        instructions: formattedInstructions,
        
        // Nutrition
        nutrition: {
          calories: extractNutritionValue(recipeData.nutrition_info?.Calories),
          protein: extractNutritionValue(recipeData.nutrition_info?.Protein),
          carbohydrates: extractNutritionValue(recipeData.nutrition_info?.Carbs),
          fat: extractNutritionValue(recipeData.nutrition_info?.Fat)
        }
      }
    };
    
    console.log(`Creating recipe at ${baseUrl}${endpoint}`);
    
    // Create the recipe
    const response = await axios.post(
      `${baseUrl}${endpoint}`,
      wprmRecipeData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${encodedAuth}`
        }
      }
    );
    
    // Extract recipe ID from the WordPress response
    const recipeId = response.data.id;
    
    if (!recipeId) {
      throw new Error('Recipe creation failed - no recipe ID returned');
    }
    
    console.log(`✓ Recipe created with ID: ${recipeId}`);
    
    // Create shortcode
    const shortcode = `[wprm-recipe id="${recipeId}"]`;
    
    // Return the data without adding the shortcode to the post here
    // This prevents duplication with recipe-helper.js which also adds the shortcode
    return { 
      success: true, 
      data: response.data,
      recipeId: recipeId,
      shortcode: shortcode
    };
  } catch (error) {
    console.error('Error adding WPRM recipe to post:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

/**
 * Update post content with recipe shortcode, ensuring it's at the end and not duplicated
 * @param {Object} wpConfig - WordPress configuration
 * @param {number} postId - Post ID
 * @param {string} shortcode - Recipe shortcode
 */
async function updatePostWithRecipeShortcode(wpConfig, postId, shortcode) {
  try {
    console.log(`Adding shortcode ${shortcode} to post ${postId}`);
    
    // Create auth header
    const authString = `${wpConfig.username}:${wpConfig.password}`;
    const encodedAuth = Buffer.from(authString).toString('base64');
    
    // Get the current post content
    const postResponse = await axios.get(
      `${wpConfig.apiUrl}/posts/${postId}`,
      {
        headers: {
          'Authorization': `Basic ${encodedAuth}`
        }
      }
    );
    
    // Extract current content
    let currentContent = '';
    
    if (postResponse.data.content && postResponse.data.content.raw) {
      currentContent = postResponse.data.content.raw;
    } else if (postResponse.data.content && postResponse.data.content.rendered) {
      currentContent = postResponse.data.content.rendered
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&');
    } else if (typeof postResponse.data.content === 'string') {
      currentContent = postResponse.data.content;
    }
    
    // Check for any existing recipe shortcodes and remove them
    const shortcodeRegex = /\[wprm-recipe[^\]]*\]/g;
    const existingShortcodes = [];
    let match;
    
    // Find all existing recipe shortcodes
    while ((match = shortcodeRegex.exec(currentContent)) !== null) {
      existingShortcodes.push(match[0]);
    }
    
    // If any recipe shortcodes exist, remove them all
    if (existingShortcodes.length > 0) {
      console.log(`Found ${existingShortcodes.length} existing recipe shortcode(s), removing them`);
      
      for (const existingShortcode of existingShortcodes) {
        currentContent = currentContent.replace(existingShortcode, '');
      }
      
      // Clean up any empty lines after removal
      currentContent = currentContent.replace(/\n\n\n+/g, '\n\n');
    }
    
    // Add the shortcode at the end with clear separation
    const newContent = currentContent.trim() + '\n\n<!-- WP Recipe Maker Recipe -->\n' + shortcode + '\n\n';
    
    // Update the post
    await axios.put(
      `${wpConfig.apiUrl}/posts/${postId}`,
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
    
    console.log('✓ Post updated with recipe shortcode');
  } catch (error) {
    console.error('Error updating post with shortcode:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

/**
 * Generate a meaningful step title based on the instruction
 * @param {number} stepNumber - Step number
 * @param {string} instruction - The first instruction in the step
 * @returns {string} - A descriptive step title
 */
function getStepTitle(stepNumber, instruction) {
    // Common cooking actions that can be used as step titles
    const cookingActions = [
        'Prepare', 'Mix', 'Combine', 'Cook', 'Bake', 'Grill', 'Roast', 'Sauté',
        'Chop', 'Slice', 'Dice', 'Boil', 'Simmer', 'Fry', 'Assemble', 'Serve'
    ];
    
    // Check if instruction contains any of the cooking actions
    for (const action of cookingActions) {
        if (instruction.includes(action) || instruction.includes(action.toLowerCase())) {
            // Extract a few words after the action for a more descriptive title
            const actionIndex = instruction.toLowerCase().indexOf(action.toLowerCase());
            const words = instruction.substring(actionIndex).split(' ').slice(0, 4).join(' ');
            return words;
        }
    }
    
    // Default titles based on common recipe steps if no cooking action is found
    const defaultTitles = {
        1: 'Prepare Ingredients',
        2: 'Cook',
        3: 'Combine',
        4: 'Finish',
        5: 'Serve'
    };
    
    return defaultTitles[stepNumber] || `Step ${stepNumber}`;
}

/**
 * Extract minutes from time string
 * @param {string} timeString - Time string (e.g., "30 mins", "1 hour 15 minutes")
 * @returns {number} Time in minutes
 */
function extractTimeMinutes(timeString) {
  if (!timeString || timeString === 'N/A') return 0;
  
  let minutes = 0;
  
  // Extract hours
  const hoursMatch = timeString.match(/(\d+)\s*(?:hour|hr)s?/i);
  if (hoursMatch) {
    minutes += parseInt(hoursMatch[1], 10) * 60;
  }
  
  // Extract minutes
  const minutesMatch = timeString.match(/(\d+)\s*(?:minute|min)s?/i);
  if (minutesMatch) {
    minutes += parseInt(minutesMatch[1], 10);
  }
  
  return minutes;
}

/**
 * Extract numeric value from nutrition string
 * @param {string} nutritionString - Nutrition string (e.g., "300 kcal", "25g")
 * @returns {number} Numeric value
 */
function extractNutritionValue(nutritionString) {
  if (!nutritionString || nutritionString === 'N/A') return 0;
  
  const match = nutritionString.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
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
 * Test the WP Recipe Maker API connection using WordPress API
 * @param {Object} wpConfig - WordPress configuration
 * @returns {Object} Test result
 */
async function testWPRMApiConnection(wpConfig) {
  try {
    // Basic validation
    if (!wpConfig || !wpConfig.apiUrl) {
      throw new Error('Missing required parameters for testing WPRM API connection');
    }
    
    // Parse the API URL
    const parsedUrl = url.parse(wpConfig.apiUrl);
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
    
    // Use the working endpoint found in test-wprm-api.js
    const testEndpoint = '/wp-json/wp/v2/wprm_recipe';
    
    // Create auth header
    const authString = `${wpConfig.username}:${wpConfig.password}`;
    const encodedAuth = Buffer.from(authString).toString('base64');
    
    console.log(`Testing WP Recipe Maker API connection to: ${baseUrl}${testEndpoint}`);
    
    // Use axios for the request - test with a GET request
    const response = await axios.get(
      `${baseUrl}${testEndpoint}`,
      {
        headers: {
          'Authorization': `Basic ${encodedAuth}`
        }
      }
    );
    
    console.log('WP Recipe Maker API connection test successful');
    return { success: true };
  } catch (error) {
    // Special handling for empty lists (which are valid)
    if (error.response && error.response.status === 200) {
      console.log('WP Recipe Maker API connection test successful (empty recipe list)');
      return { success: true };
    }
    
    console.error('WP Recipe Maker API connection test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

/**
 * Test direct recipe creation with minimal data
 * Used by test-minimal-recipe.js
 * @param {Object} wpConfig - WordPress configuration
 * @param {number} postId - Post ID to associate with recipe
 * @param {Object} recipeData - Basic recipe data to create
 * @returns {number|null} Recipe ID if successful, null if not
 */
async function testDirectRecipeCreation(wpConfig, postId, recipeData) {
  try {
    console.log(`Testing direct recipe creation for post ID: ${postId}`);
    
    // Create auth header
    const authString = `${wpConfig.username}:${wpConfig.password}`;
    const encodedAuth = Buffer.from(authString).toString('base64');
    
    // Parse the API URL
    const parsedUrl = url.parse(wpConfig.apiUrl);
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
    
    // Use the working endpoint
    const endpoint = '/wp-json/wp/v2/wprm_recipe';
    
    // Create minimal recipe data
    const minimalRecipeData = {
      title: recipeData.title,
      status: 'publish',
      content: recipeData.description || 'A test recipe.',
      
      recipe: {
        parent_post_id: postId,
        name: recipeData.title,
        summary: recipeData.description || "A test recipe.",
        
        // Add minimal ingredients and instructions
        ingredients: [{
          name: "",
          uid: -1,
          ingredients: [{
            uid: 0,
            amount: "1",
            unit: "tbsp",
            name: "test ingredient",
            notes: ""
          }]
        }],
        
        instructions: [{
          name: "",
          uid: -1,
          instructions: [{
            uid: 0,
            name: "",
            text: "<p>Test instruction</p>",
            image: 0,
            ingredients: []
          }]
        }]
      }
    };
    
    // Create the recipe
    const response = await axios.post(
      `${baseUrl}${endpoint}`,
      minimalRecipeData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${encodedAuth}`
        }
      }
    );
    
    console.log(`Recipe created with ID: ${response.data.id}`);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
    return response.data.id;
  } catch (error) {
    console.error('Error creating minimal recipe:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return null;
  }
}

module.exports = {
  addRecipeToPost,
  updatePostWithRecipeShortcode,
  testWPRMApiConnection,
  testDirectRecipeCreation
};