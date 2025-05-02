// src/app.js
//
// This is the main application file that:
// 1. Loads the configuration
// 2. Sets up the environment
// 3. Executes the workflow

// Import required modules
const { config, validateConfig } = require('./config');
const { readKeywordsFromExcel, updateExcelWithPublicationStatus, createSampleExcelFile } = require('./excel');
const { generateArticleContent } = require('./openai');
const { testWordPressConnection, publishToWordPress } = require('./wordpress');
const recipeHelper = require('./recipe-helper');
const { OpenAI } = require('openai');

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after ms milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate article with recipe integration if applicable
 * @param {string} keyword - Keyword for the article
 * @param {Object} config - Application configuration
 * @returns {Object} Generation result with post ID
 */
async function generateArticleWithRecipe(keyword, config) {
  try {
    console.log(`Generating article with potential recipe for keyword: ${keyword}`);
    
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
    
    // 1. Generate the regular article content
    // Prepare prompt settings
    const promptSettings = config.prompts.useMultiPartGeneration || config.prompts.toneVoice || 
                          config.prompts.seoGuidelines || config.prompts.thingsToAvoid || 
                          config.prompts.mainPrompt ? {
      useMultiPartGeneration: config.prompts.useMultiPartGeneration,
      mainPrompt: config.prompts.mainPrompt || config.app.contentTemplate,
      part1Prompt: config.prompts.part1Prompt,
      part2Prompt: config.prompts.part2Prompt,
      part3Prompt: config.prompts.part3Prompt,
      toneVoice: config.prompts.toneVoice,
      seoGuidelines: config.prompts.seoGuidelines,
      thingsToAvoid: config.prompts.thingsToAvoid,
      articleFormat: config.prompts.articleFormat,
      useArticleFormat: config.prompts.useArticleFormat,
      enableRecipeDetection: config.prompts.enableRecipeDetection,
      recipeFormatPrompt: config.prompts.recipeFormatPrompt
    } : null;
    
    const articleResult = await generateArticleContent(
      config.openai, 
      keyword, 
      config.app.minWords,
      promptSettings
    );
    
    // Check if article generation was successful
    if (!articleResult || !articleResult.content) {
      throw new Error('Article generation failed');
    }
    
    // 2. Check if this keyword should include a recipe
    let recipeData = null;
    
    if (recipeHelper.shouldAddRecipe(keyword, config.recipe)) {
      console.log(`Keyword "${keyword}" qualifies for recipe generation`);
      
      // Generate recipe data based on the keyword
      recipeData = await recipeHelper.generateRecipeData(
        openai,
        config.openai,
        keyword
      );
      
      if (recipeData) {
        console.log(`Recipe generated: "${recipeData.title}"`);
      } else {
        console.log('Recipe generation failed or was skipped');
      }
    }
    
    // 3. Create WordPress post
    const postResult = await publishToWordPress(
      config.wordpress,
      {
        title: articleResult.title,
        content: articleResult.content
      },
      keyword,
      config.app.publishStatus
    );
    
    // Check if post creation was successful
    if (!postResult || !postResult.postId) {
      throw new Error('WordPress post creation failed');
    }
    
    console.log(`Created article for "${keyword}" - Post ID: ${postResult.postId}`);
    
    // 4. Add recipe to the post if recipe was generated successfully
    if (recipeData && postResult.postId && config.recipe && config.recipe.enabled) {
      try {
        await recipeHelper.addRecipeToPost(
          config.wordpress,
          config.recipe,
          recipeData,
          postResult.postId
        );
        console.log(`Recipe added to post ID: ${postResult.postId}`);
      } catch (recipeError) {
        console.error(`Error adding recipe to post: ${recipeError.message}`);
        // Continue with the process even if recipe addition fails
      }
    }
    
    // 5. Return the result
    return {
      success: true,
      postId: postResult.postId,
      postUrl: postResult.postUrl,
      recipeAdded: recipeData !== null
    };
  } catch (error) {
    console.error('Error in article generation with recipe:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Update keyword status in database/Excel
 * @param {string} keyword - The keyword 
 * @param {string} status - Status (Published, Failed, etc.)
 * @param {number} postId - WordPress post ID
 * @param {string} postUrl - WordPress post URL
 * @param {string} errorMsg - Error message if failed
 */
async function updateKeywordStatus(keyword, status, postId, postUrl, errorMsg = '') {
  try {
    // Find the keyword in the Excel file
    const keywordRows = readKeywordsFromExcel(config.app.excelFile, config.app.keywordColumn);
    const keywordRow = keywordRows.find(row => row[config.app.keywordColumn] === keyword);
    
    if (!keywordRow) {
      console.error(`Keyword "${keyword}" not found in Excel file`);
      return;
    }
    
    // Create publish data object
    const publishData = {
      status: status,
      postId: postId,
      postUrl: postUrl
    };
    
    // Update the Excel file
    updateExcelWithPublicationStatus(config.app.excelFile, keywordRow, publishData);
    
  } catch (error) {
    console.error(`Error updating keyword status: ${error.message}`);
  }
}

/**
 * Process a single keyword
 * @param {string} keyword - Keyword to process
 * @param {Object} config - Application configuration
 * @param {Object} jobContext - Job context for status updates
 * @returns {boolean} True if successful
 */
async function processKeyword(keyword, config, jobContext) {
  try {
    // Update status
    jobContext.updateStatus(`Processing keyword: ${keyword}`);
    
    // Generate article with recipe if applicable
    const result = await generateArticleWithRecipe(keyword, config);
    
    if (result.success) {
      // Update job status
      const recipeMsg = result.recipeAdded ? ' (with recipe)' : '';
      jobContext.updateStatus(`Created article for "${keyword}"${recipeMsg} - Post ID: ${result.postId}`);
      
      // Update keyword status in database
      await updateKeywordStatus(keyword, 'Published', result.postId, result.postUrl);
      
      return true;
    } else {
      // Handle error
      jobContext.updateStatus(`Failed to create article for "${keyword}": ${result.error}`);
      
      // Update keyword status in database
      await updateKeywordStatus(keyword, 'Failed', null, null, result.error);
      
      return false;
    }
  } catch (error) {
    console.error(`Error processing keyword "${keyword}":`, error);
    jobContext.updateStatus(`Error processing "${keyword}": ${error.message}`);
    
    // Update keyword status in database
    await updateKeywordStatus(keyword, 'Failed', null, null, error.message);
    
    return false;
  }
}

/**
 * Main function to run the automation
 */
async function runAutomation() {
  console.log('=========================================');
  console.log('WordPress Article Automation');
  console.log('=========================================');
  
  // Create job context for status updates
  const jobContext = {
    updateStatus: (status) => {
      console.log(status);
    }
  };
  
  try {
    // Step 1: Validate configuration
    console.log('\nStep 1: Validating configuration...');
    if (!validateConfig()) {
      return;
    }
    console.log('✓ Configuration validated');
    
    // Create sample Excel file if it doesn't exist
    createSampleExcelFile(config.app.excelFile);
    
    // Step 2: Test WordPress connection
    console.log('\nStep 2: Testing WordPress connection...');
    const wpConnectionSuccess = await testWordPressConnection(config.wordpress);
    if (!wpConnectionSuccess) {
      console.error('WordPress connection failed. Please check your credentials and try again.');
      return;
    }
    
    // Step 3: Read keywords from Excel
    console.log('\nStep 3: Reading keywords from Excel...');
    const keywordRows = readKeywordsFromExcel(config.app.excelFile, config.app.keywordColumn);
    
    if (keywordRows.length === 0) {
      console.log('No pending keywords found in Excel file. Nothing to do.');
      return;
    }
    
    console.log(`Found ${keywordRows.length} keywords to process:`);
    keywordRows.forEach((row, index) => {
      console.log(`${index + 1}. ${row[config.app.keywordColumn]}`);
    });
    
    // Step 4: Process each keyword
    console.log('\nStep 4: Processing keywords...');
    let successCount = 0;
    let failureCount = 0;
    
    for (let i = 0; i < keywordRows.length; i++) {
      const keywordRow = keywordRows[i];
      const keyword = keywordRow[config.app.keywordColumn];
      
      console.log(`\nProcessing ${i + 1}/${keywordRows.length}: "${keyword}"`);
      
      try {
        // Use the new process keyword function
        const success = await processKeyword(keyword, config, jobContext);
        
        if (success) {
          successCount++;
        } else {
          failureCount++;
        }
        
        // Add a delay between processing keywords to avoid rate limiting
        if (i < keywordRows.length - 1) {
          console.log(`Waiting ${config.app.delayBetweenPosts / 1000} seconds before next keyword...`);
          await sleep(config.app.delayBetweenPosts);
        }
      } catch (error) {
        console.error(`✗ Failed to process keyword "${keyword}":`, error.message);
        failureCount++;
        
        // Continue with next keyword
        continue;
      }
    }
    
    // Step 5: Summary
    console.log('\n=========================================');
    console.log('Summary:');
    console.log(`Total keywords: ${keywordRows.length}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Failed: ${failureCount}`);
    console.log('=========================================');
    
    console.log('\nAutomation completed!');
    
  } catch (error) {
    console.error('Automation failed:', error.message);
  }
}

// Run the automation
runAutomation();