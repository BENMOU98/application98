// src/wordpress.js
//
// This module handles WordPress API interactions without using axios

const https = require('https');
const url = require('url');
const axios = require('axios'); // Make sure axios is at the top level

/**
 * Test the WordPress API connection
 * @param {Object} wpConfig - WordPress configuration
 * @returns {boolean} True if connection successful
 */
async function testWordPressConnection(wpConfig) {
  try {
    console.log(`Testing WordPress API connection to ${wpConfig.apiUrl}...`);
    
    // Test authentication
    await testAuthentication(wpConfig);
    console.log('✓ Authentication successful');
    
    return true;
  } catch (error) {
    console.error('✗ WordPress connection test failed:', error.message);
    return false;
  }
}

/**
 * Test WordPress authentication using native https
 * @param {Object} wpConfig - WordPress configuration
 */
async function testAuthentication(wpConfig) {
  return new Promise((resolve, reject) => {
    try {
      // Parse the API URL
      const parsedUrl = url.parse(wpConfig.apiUrl);
      
      // Create authentication header
      const authString = `${wpConfig.username}:${wpConfig.password}`;
      const encodedAuth = Buffer.from(authString).toString('base64');
      
      // Set up request options
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}/users/me`,
        method: 'GET',
        headers: {
          'Authorization': `Basic ${encodedAuth}`,
          'Content-Type': 'application/json'
        },
        rejectUnauthorized: false // Allow self-signed certificates
      };
      
      console.log(`Testing authentication to ${options.hostname}${options.path}`);
      
      // Make the request
      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const responseData = JSON.parse(data);
              console.log(`Logged in as: ${responseData.name || 'User'} (ID: ${responseData.id})`);
              resolve(responseData);
            } else {
              console.error(`Authentication failed with status code: ${res.statusCode}`);
              console.error(`Response: ${data}`);
              reject(new Error(`Authentication failed with status ${res.statusCode}`));
            }
          } catch (error) {
            console.error('Error parsing authentication response:', error);
            reject(error);
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('Authentication request error:', error);
        reject(error);
      });
      
      req.end();
    } catch (error) {
      console.error('Error setting up authentication request:', error);
      reject(error);
    }
  });
}

/**
 * Format HTML content for WordPress Gutenberg blocks
 * @param {string} content - HTML content
 * @returns {string} Formatted content with Gutenberg blocks
 */
function formatContentForWordPress(content) {
  try {
    // Ensure content is a string - this is crucial to prevent the lastIndexOf error
    if (!content || typeof content !== 'string') {
      console.warn('Content is not a string, converting to string');
      content = String(content || '');
    }
    
    // Check if the content already has HTML tags
    const hasHtmlTags = /<\/?[a-z][\s\S]*>/i.test(content);
    
    if (hasHtmlTags) {
      // Convert HTML content to WordPress Gutenberg blocks
      return content
        .replace(/<h2>(.*?)<\/h2>/gi, '<!-- wp:heading --><h2>$1</h2><!-- /wp:heading -->')
        .replace(/<h3>(.*?)<\/h3>/gi, '<!-- wp:heading {"level":3} --><h3>$1</h3><!-- /wp:heading -->')
        .replace(/<p>(.*?)<\/p>/gi, '<!-- wp:paragraph --><p>$1</p><!-- /wp:paragraph -->')
        .replace(/<ul>([\s\S]*?)<\/ul>/gi, '<!-- wp:list --><ul>$1</ul><!-- /wp:list -->')
        .replace(/<ol>([\s\S]*?)<\/ol>/gi, '<!-- wp:list {"ordered":true} --><ol>$1</ol><!-- /wp:list -->');
    } else {
      // If no HTML tags, format the content as WordPress blocks
      return content
        .split('\n\n')
        .map(para => para.trim())
        .filter(para => para.length > 0)
        .map(para => {
          // Check if paragraph is a heading
          if (para.startsWith('# ')) {
            return `<!-- wp:heading --><h2>${para.substring(2)}</h2><!-- /wp:heading -->`;
          } else if (para.startsWith('## ')) {
            return `<!-- wp:heading --><h2>${para.substring(3)}</h2><!-- /wp:heading -->`;
          } else if (para.startsWith('### ')) {
            return `<!-- wp:heading {"level":3} --><h3>${para.substring(4)}</h3><!-- /wp:heading -->`;
          } else {
            // Regular paragraph
            return `<!-- wp:paragraph --><p>${para}</p><!-- /wp:paragraph -->`;
          }
        })
        .join('\n\n');
    }
  } catch (error) {
    console.error('Error formatting content:', error);
    return String(content || ''); // Return stringified content if formatting fails
  }
}

/**
 * Simple function to create plain text from HTML
 * @param {string} html - HTML content
 * @returns {string} Plain text content
 */
function htmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Publish article to WordPress using axios
 * @param {Object} wpConfig - WordPress configuration
 * @param {Object} article - Article with title and content
 * @param {string} keyword - Keyword for the article
 * @param {string} status - 'draft' or 'publish'
 * @returns {Object} WordPress API response
 */
async function publishToWordPress(wpConfig, article, keyword, status = 'draft') {
  try {
    // Create auth header
    const authString = `${wpConfig.username}:${wpConfig.password}`;
    const encodedAuth = Buffer.from(authString).toString('base64');
    
    // Prepare the post content (without excessive formatting)
    let formattedContent = article.content;
    
    // Check if we need to format the content
    if (article.formatContent !== false) {
      formattedContent = formatContentForWordPress(article.content);
    }
    
    // Create the post
    console.log(`Publishing article: ${article.title} (${status})`);
    console.log(`Content size: ${formattedContent.length} characters`);
    
    // Simplify the post data to match direct-test.js approach
    const postData = {
      title: article.title,
      content: formattedContent,
      status: status
    };
    
    // For debugging
    console.log(`Sending post request to: ${wpConfig.apiUrl}/posts`);
    
    const response = await axios.post(
      `${wpConfig.apiUrl}/posts`,
      postData,
      {
        headers: {
          'Authorization': `Basic ${encodedAuth}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Process the response
    const postId = response.data.id;
    const postUrl = response.data.link;
    
    console.log(`✓ Article published successfully as ${status}`);
    console.log(`Post ID: ${postId}`);
    console.log(`Post URL: ${postUrl}`);
    
    return {
      postId,
      postUrl,
      status: 'Published',
      publishDate: new Date().toISOString().split('T')[0]
    };
  } catch (error) {
    console.error(`Error publishing to WordPress: ${error.message}`);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

/**
 * Direct publishing method matching the direct-test.js approach
 * This is a simplified version without content formatting
 * @param {Object} wpConfig - WordPress configuration
 * @param {Object} article - Article with title and content
 * @param {string} status - 'draft' or 'publish'
 * @param {number} [existingPostId] - Optional ID of an existing post to update
 * @returns {Object} WordPress API response
 */
async function directPublishToWordPress(wpConfig, article, status = 'draft', existingPostId = null) {
  try {
    // Create auth header
    const authString = `${wpConfig.username}:${wpConfig.password}`;
    const encodedAuth = Buffer.from(authString).toString('base64');
    
    // Simple post data with minimal content
    const postData = {
      title: article.title,
      content: article.content, // No formatting, use content as-is
      status: status
    };
    
    // Determine if we're creating a new post or updating an existing one
    const isUpdate = existingPostId !== null;
    const endpoint = isUpdate 
      ? `${wpConfig.apiUrl}/posts/${existingPostId}` 
      : `${wpConfig.apiUrl}/posts`;
    
    console.log(`${isUpdate ? 'Updating' : 'Direct publishing'} article: ${article.title} (${status})`);
    
    const response = await axios.post(
      endpoint,
      postData,
      {
        headers: {
          'Authorization': `Basic ${encodedAuth}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Process the response
    const postId = response.data.id;
    const postUrl = response.data.link;
    
    console.log(`✓ Article ${isUpdate ? 'updated' : 'published'} successfully as ${status}`);
    console.log(`Post ID: ${postId}`);
    console.log(`Post URL: ${postUrl}`);
    
    return {
      postId,
      postUrl,
      status: isUpdate ? 'Updated' : 'Published',
      publishDate: new Date().toISOString().split('T')[0]
    };
  } catch (error) {
    console.error(`Error in direct publishing: ${error.message}`);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

// Update to the wordpress.js file - Add this at the end of the file, right before the module.exports
/**
 * Enhanced publishToWordPress that includes recipe integration check
 * 
 * @param {Object} wpConfig - WordPress configuration
 * @param {Object} article - Article with title and content
 * @param {string} keyword - Keyword for the article 
 * @param {string} status - 'draft' or 'publish'
 * @returns {Object} WordPress API response
 */
async function publishWithRecipeCheck(wpConfig, article, keyword, status = 'draft', config = null) {
  // If no full config provided, just use regular publishing
  if (!config || !config.recipe || !config.recipe.enabled) {
    return publishToWordPress(wpConfig, article, keyword, status);
  }
  
  try {
    // Import the recipe integration plugin
    const recipePlugin = require('./recipe-integration-plugin');
    
    // Check if this article needs recipe integration
    const integrationResult = await recipePlugin.integrateRecipeIfNeeded(keyword, article, config);
    
    // If recipe was integrated, return that result directly
    if (integrationResult.success && integrationResult.postId) {
      return {
        postId: integrationResult.postId,
        postUrl: integrationResult.postUrl,
        status: integrationResult.status || 'Published',
        publishDate: integrationResult.publishDate
      };
    }
    
    // Otherwise, use the regular publishing method
    return publishToWordPress(wpConfig, integrationResult.article || article, keyword, status);
  } catch (error) {
    console.error('Error in recipe-aware publishing:', error);
    // Fall back to regular publishing method
    return publishToWordPress(wpConfig, article, keyword, status);
  }
}

/**
 * Process SEO template variables
 * @param {string} template - Template with variables
 * @param {string} articleTitle - Article title
 * @param {string} siteName - Site name
 * @returns {string} Processed template
 */
function processSeoTemplate(template, articleTitle, siteName = 'Recipe Elegance') {
  if (!template || typeof template !== 'string') return '';
  
  // Replace all template variables
  return template
    .replace(/%title%/g, articleTitle || '')
    .replace(/%sep%/g, ' - ')
    .replace(/%sitename%/g, siteName);
}

// Update the exports to include the new function
module.exports = {
  testWordPressConnection,
  testAuthentication,
  publishToWordPress,
  directPublishToWordPress,
  formatContentForWordPress,
  publishWithRecipeCheck,
  processSeoTemplate  // Add this line
};
