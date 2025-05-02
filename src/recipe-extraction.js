// src/recipe-extraction.js
//
// This module handles extraction of recipe data from article content

/**
 * Extract recipe data from article content
 * @param {string} content - Article content
 * @param {string} keyword - Original keyword
 * @returns {Object|null} Extracted recipe data or null if no recipe found
 */
function extractRecipeData(content, keyword) {
  try {
    console.log(`Attempting to extract recipe data from content for keyword: ${keyword}`);
    
    // If content is not a string, return null
    if (!content || typeof content !== 'string') {
      console.warn('Content is not a string, cannot extract recipe data');
      return null;
    }
    
    // Check if the content contains recipe indicators
    const hasRecipeIndicators = (
      content.toLowerCase().includes('ingredients:') ||
      content.toLowerCase().includes('instructions:') ||
      content.toLowerCase().includes('preparation time:') ||
      content.toLowerCase().includes('cooking time:') ||
      content.toLowerCase().includes('servings:') ||
      content.toLowerCase().includes('prep time:') ||
      content.toLowerCase().includes('cook time:')
    );
    
    if (!hasRecipeIndicators) {
      console.log('No recipe indicators found in content');
      return null;
    }
    
    // Extract recipe title
    let title = keyword;
    const titleMatches = [
      // Match pattern like "<h2>Recipe: Title</h2>" or "<h2>Title Recipe</h2>"
      /<h[2-3]>(?:Recipe:\s*)?(.+?)\s*(?:Recipe)?<\/h[2-3]>/i,
      // Match any heading that contains the word recipe
      /<h[2-3]>(.+?recipe.+?)<\/h[2-3]>/i,
      // Match any heading that might be a recipe title (after ingredients)
      /<h[2-3]>(.+?)<\/h[2-3]>(?:(?!<h[2-3]).)*?ingredients/is
    ];
    
    for (const pattern of titleMatches) {
      const match = content.match(pattern);
      if (match && match[1]) {
        title = match[1].trim();
        break;
      }
    }
    
    // Extract ingredients
    let ingredients = [];
    // Look for ingredients list - typically in a <ul> after "ingredients" heading
    const ingredientsRegex = /<h[2-3][^>]*>.*?ingredients.*?<\/h[2-3]>(?:(?!<h[2-3]).)*?<ul>(.*?)<\/ul>/is;
    const ingredientsMatch = content.match(ingredientsRegex);
    
    if (ingredientsMatch && ingredientsMatch[1]) {
      // Extract <li> items from the ingredients list
      const liItems = ingredientsMatch[1].match(/<li>(.*?)<\/li>/g);
      if (liItems) {
        ingredients = liItems.map(item => 
          item.replace(/<li>(.*?)<\/li>/i, '$1')
            .replace(/<[^>]*>/g, '') // Remove any remaining HTML tags
            .trim()
        );
      }
    }
    
    // If no ingredients found in the expected format, try a fallback approach
    if (ingredients.length === 0) {
      // Look for any list that might contain ingredients
      const anyListRegex = /<ul>(.*?)<\/ul>/is;
      const anyListMatch = content.match(anyListRegex);
      
      if (anyListMatch && anyListMatch[1]) {
        // Extract <li> items from the list
        const liItems = anyListMatch[1].match(/<li>(.*?)<\/li>/g);
        if (liItems) {
          ingredients = liItems.map(item => 
            item.replace(/<li>(.*?)<\/li>/i, '$1')
              .replace(/<[^>]*>/g, '') // Remove any remaining HTML tags
              .trim()
          );
        }
      }
    }
    
    // Extract instructions
    let instructions = [];
    // Look for instructions list - typically in a <ol> after "instructions" heading
    const instructionsRegex = /<h[2-3][^>]*>.*?instructions.*?<\/h[2-3]>(?:(?!<h[2-3]).)*?<ol>(.*?)<\/ol>/is;
    const instructionsMatch = content.match(instructionsRegex);
    
    if (instructionsMatch && instructionsMatch[1]) {
      // Extract <li> items from the instructions list
      const liItems = instructionsMatch[1].match(/<li>(.*?)<\/li>/g);
      if (liItems) {
        instructions = liItems.map(item => 
          item.replace(/<li>(.*?)<\/li>/i, '$1')
            .replace(/<[^>]*>/g, '') // Remove any remaining HTML tags
            .trim()
        );
      }
    }
    
    // If no instructions found in the expected format, try a fallback approach
    if (instructions.length === 0) {
      // Look for any numbered list that might contain instructions
      const anyOrderedListRegex = /<ol>(.*?)<\/ol>/is;
      const anyOrderedListMatch = content.match(anyOrderedListRegex);
      
      if (anyOrderedListMatch && anyOrderedListMatch[1]) {
        // Extract <li> items from the list
        const liItems = anyOrderedListMatch[1].match(/<li>(.*?)<\/li>/g);
        if (liItems) {
          instructions = liItems.map(item => 
            item.replace(/<li>(.*?)<\/li>/i, '$1')
              .replace(/<[^>]*>/g, '') // Remove any remaining HTML tags
              .trim()
          );
        }
      }
    }
    
    // Extract prep time, cook time, and servings
    const prepTimeRegex = /prep(?:aration)? time:?\s*([0-9]+\s*(?:minute|min|hour|hr)s?)/i;
    const cookTimeRegex = /cook(?:ing)? time:?\s*([0-9]+\s*(?:minute|min|hour|hr)s?)/i;
    const servingsRegex = /(?:servings|yield|serves):?\s*([0-9]+(?:-[0-9]+)?(?:\s*(?:person|people|serving)s?)?)/i;
    
    let prepTime = 'N/A';
    let cookTime = 'N/A';
    let yield = 'N/A';
    
    // Extract preparation time
    const prepTimeMatch = content.match(prepTimeRegex);
    if (prepTimeMatch && prepTimeMatch[1]) {
      prepTime = prepTimeMatch[1].trim();
    }
    
    // Extract cooking time
    const cookTimeMatch = content.match(cookTimeRegex);
    if (cookTimeMatch && cookTimeMatch[1]) {
      cookTime = cookTimeMatch[1].trim();
    }
    
    // Extract servings/yield
    const servingsMatch = content.match(servingsRegex);
    if (servingsMatch && servingsMatch[1]) {
      yield = servingsMatch[1].trim();
    }
    
    // Extract notes (if any)
    let notes = [];
    // Look for notes or tips section
    const notesRegex = /<h[2-3][^>]*>.*?(?:notes|tips).*?<\/h[2-3]>(?:(?!<h[2-3]).)*?<(?:ul|p)>(.*?)<\/(?:ul|p)>/is;
    const notesMatch = content.match(notesRegex);
    
    if (notesMatch && notesMatch[1]) {
      // Check if the notes are in a list
      if (notesMatch[1].includes('<li>')) {
        // Extract <li> items from the notes list
        const liItems = notesMatch[1].match(/<li>(.*?)<\/li>/g);
        if (liItems) {
          notes = liItems.map(item => 
            item.replace(/<li>(.*?)<\/li>/i, '$1')
              .replace(/<[^>]*>/g, '') // Remove any remaining HTML tags
              .trim()
          );
        }
      } else {
        // Notes are in paragraphs
        const noteText = notesMatch[1].replace(/<[^>]*>/g, '').trim();
        if (noteText) {
          notes = [noteText];
        }
      }
    }
    
    // Extract nutrition info (if any)
    let nutritionInfo = {
      Calories: 'N/A',
      Protein: 'N/A',
      Carbs: 'N/A',
      Fat: 'N/A'
    };
    
    // Look for nutrition section
    const nutritionRegex = /<h[2-3][^>]*>.*?nutrition.*?<\/h[2-3]>(?:(?!<h[2-3]).)*?<(?:ul|p)>(.*?)<\/(?:ul|p)>/is;
    const nutritionMatch = content.match(nutritionRegex);
    
    if (nutritionMatch && nutritionMatch[1]) {
      // Process nutrition info
      const nutritionText = nutritionMatch[1].replace(/<[^>]*>/g, '').trim();
      
      // Extract calories
      const caloriesMatch = nutritionText.match(/calories:?\s*([0-9]+(?:\.[0-9]+)?\s*(?:kcal)?)/i);
      if (caloriesMatch && caloriesMatch[1]) {
        nutritionInfo.Calories = caloriesMatch[1].trim();
        if (!nutritionInfo.Calories.toLowerCase().includes('kcal')) {
          nutritionInfo.Calories += ' kcal';
        }
      }
      
      // Extract protein
      const proteinMatch = nutritionText.match(/protein:?\s*([0-9]+(?:\.[0-9]+)?\s*g)/i);
      if (proteinMatch && proteinMatch[1]) {
        nutritionInfo.Protein = proteinMatch[1].trim();
      }
      
      // Extract carbs
      const carbsMatch = nutritionText.match(/carbs?:?\s*([0-9]+(?:\.[0-9]+)?\s*g)/i);
      if (carbsMatch && carbsMatch[1]) {
        nutritionInfo.Carbs = carbsMatch[1].trim();
      }
      
      // Extract fat
      const fatMatch = nutritionText.match(/fat:?\s*([0-9]+(?:\.[0-9]+)?\s*g)/i);
      if (fatMatch && fatMatch[1]) {
        nutritionInfo.Fat = fatMatch[1].trim();
      }
    }
    
    // Only consider it a valid recipe if we have at least some ingredients and instructions
    if (ingredients.length === 0 || instructions.length === 0) {
      console.log('Insufficient recipe data found (missing ingredients or instructions)');
      return null;
    }
    
    // Construct and return the recipe data object
    const recipeData = {
      title,
      ingredients,
      instructions,
      prep_time: prepTime,
      cook_time: cookTime,
      yield,
      notes,
      nutrition_info: nutritionInfo
    };
    
    console.log(`Successfully extracted recipe data for "${title}"`);
    console.log(`Found ${ingredients.length} ingredients and ${instructions.length} steps`);
    
    return recipeData;
  } catch (error) {
    console.error('Error extracting recipe data:', error);
    return null;
  }
}

module.exports = {
  extractRecipeData
};