// src/recipe-integration-plugin.js
//
// This plugin ensures recipe integration works correctly across all publishing workflows

// Import required modules 
const { generateArticleWithRecipe } = require('./openai');
const recipeHelper = require('./recipe-helper');

/**
 * Check and handle recipe integration for a keyword
 * 
 * @param {string} keyword - The keyword to check for recipe eligibility
 * @param {Object} article - The article object with title and content
 * @param {Object} config - The application configuration
 * @returns {Promise<Object>} Result object with integration info
 */
async function integrateRecipeIfNeeded(keyword, article, config) {
  try {
    // First, check if recipe integration is enabled and this keyword qualifies
    const shouldAddRecipe = config.recipe && 
                           config.recipe.enabled && 
                           recipeHelper.shouldAddRecipe(keyword, config.recipe);
    
    console.log(`Checking recipe integration for keyword "${keyword}"`);
    console.log(`Recipe enabled: ${config.recipe?.enabled}, Should add recipe: ${shouldAddRecipe}`);
    
    if (shouldAddRecipe) {
      console.log(`Keyword "${keyword}" qualifies for recipe integration`);
      
      // Use the special recipe publishing method
      const result = await generateArticleWithRecipe(
        config.openai,
        config.wordpress,
        config.recipe,
        keyword,
        config.app.minWords,
        null // No special prompt settings for recipes
      );
      
      // Return result directly
      return {
        success: result.success,
        postId: result.postId,
        postUrl: result.postUrl,
        status: 'Published',
        publishDate: new Date().toISOString().split('T')[0],
        recipeAdded: result.recipeAdded
      };
    } else {
      // No recipe needed, just return the original article
      console.log(`No recipe integration needed for keyword "${keyword}"`);
      return {
        success: true,
        article: article,
        recipeAdded: false
      };
    }
  } catch (error) {
    console.error(`Error in recipe integration for "${keyword}":`, error);
    return {
      success: false,
      error: `Recipe integration failed: ${error.message}`,
      recipeAdded: false
    };
  }
}

module.exports = {
  integrateRecipeIfNeeded
};