// src/rank-math.js
//
// This module handles integration with the Rank Math SEO plugin for WordPress

const axios = require('axios');
const { URL } = require('url');
const wordpress = require('./wordpress'); // Added import for template processing

/**
 * Generate SEO metadata options using OpenAI
 * @param {Object} openaiConfig - OpenAI configuration
 * @param {Object} rankMathConfig - Rank Math configuration
 * @param {string} keyword - Focus keyword
 * @param {string} articleTitle - Article title (for context)
 * @param {string} articleExcerpt - Article excerpt/summary (for context)
 * @returns {Array} Array of SEO metadata options
 */
async function generateSeoMetadataOptions(openaiConfig, rankMathConfig, keyword, articleTitle = '', articleExcerpt = '') {
    try {
        if (!openaiConfig || !openaiConfig.apiKey || !keyword) {
            throw new Error('Missing required parameters for generating SEO metadata');
        }

        console.log(`Generating SEO metadata options for keyword: "${keyword}"`);

        // Initialize OpenAI
        const { OpenAI } = require('openai');
        const openai = new OpenAI({
            apiKey: openaiConfig.apiKey,
        });

        // Set the number of options to generate
        const optionsCount = rankMathConfig.optionsCount || 3;

        // Create prompts for title, description, and permalink
        const titlePrompt = (rankMathConfig.titlePrompt || 'Generate {count} SEO-optimized title options for an article about "{keyword}". Each title should be compelling, under 60 characters, include the focus keyword naturally, and encourage clicks.')
            .replace('{keyword}', keyword)
            .replace('{count}', optionsCount);

        const descriptionPrompt = (rankMathConfig.descriptionPrompt || 'Generate {count} SEO meta descriptions for an article about "{keyword}". Each description should be 150-160 characters, include the focus keyword, summarize the content value, and include a call-to-action.')
            .replace('{keyword}', keyword)
            .replace('{count}', optionsCount);

        const permalinkPrompt = (rankMathConfig.permalinkPrompt || 'Generate {count} SEO-friendly URL slugs for an article about "{keyword}". Each slug should be short (3-5 words), include the main keyword, use hyphens between words, avoid stop words, and be all lowercase.')
            .replace('{keyword}', keyword)
            .replace('{count}', optionsCount);

        // Add context to the prompts if available
        let titlePromptWithContext = titlePrompt;
        let descriptionPromptWithContext = descriptionPrompt;

        if (articleTitle) {
            titlePromptWithContext += `\n\nThe current article title is: "${articleTitle}"`;
            descriptionPromptWithContext += `\n\nThe current article title is: "${articleTitle}"`;
        }

        if (articleExcerpt) {
            descriptionPromptWithContext += `\n\nArticle excerpt: "${articleExcerpt}"`;
        }

        // Generate title options
        console.log('Generating title options...');
        const titleResponse = await openai.chat.completions.create({
            model: openaiConfig.model || 'gpt-3.5-turbo',
            messages: [
                { role: "system", content: "You are an SEO expert who creates compelling and optimized titles." },
                { role: "user", content: titlePromptWithContext }
            ],
            max_tokens: 200,
            temperature: 0.7,
        });

        // Generate description options
        console.log('Generating description options...');
        const descriptionResponse = await openai.chat.completions.create({
            model: openaiConfig.model || 'gpt-3.5-turbo',
            messages: [
                { role: "system", content: "You are an SEO expert who creates compelling and optimized meta descriptions." },
                { role: "user", content: descriptionPromptWithContext }
            ],
            max_tokens: 400,
            temperature: 0.7,
        });

        // Generate permalink options
        console.log('Generating permalink options...');
        const permalinkResponse = await openai.chat.completions.create({
            model: openaiConfig.model || 'gpt-3.5-turbo',
            messages: [
                { role: "system", content: "You are an SEO expert who creates clean and optimized URL slugs." },
                { role: "user", content: permalinkPrompt }
            ],
            max_tokens: 200,
            temperature: 0.7,
        });

        // Process the responses
        const titleContent = titleResponse.choices[0].message.content.trim();
        const descriptionContent = descriptionResponse.choices[0].message.content.trim();
        const permalinkContent = permalinkResponse.choices[0].message.content.trim();

        // Parse the options from the responses
        const titleOptions = extractNumberedItems(titleContent, optionsCount);
        const descriptionOptions = extractNumberedItems(descriptionContent, optionsCount);
        const permalinkOptions = extractNumberedItems(permalinkContent, optionsCount);

        // Combine into metadata options
        const seoOptions = [];
        for (let i = 0; i < optionsCount; i++) {
            seoOptions.push({
                title: titleOptions[i] || `SEO Title Option ${i + 1}`,
                description: descriptionOptions[i] || `SEO description for ${keyword}.`,
                permalink: permalinkOptions[i] || keyword.toLowerCase().replace(/\s+/g, '-'),
            });
        }

        console.log(`Successfully generated ${seoOptions.length} SEO metadata options`);
        return seoOptions;
    } catch (error) {
        console.error('Error generating SEO metadata:', error);
        throw error;
    }
}

/**
 * Extract numbered items from a response string
 * @param {string} content - Response content
 * @param {number} count - Expected number of items
 * @returns {Array} Extracted items
 */
function extractNumberedItems(content, count) {
    // Remove any potential markdown formatting
    const cleanContent = content.replace(/```[^`]*```/g, '').trim();
    
    // First try to extract items with a numbered pattern (1., 2., etc.)
    const numberedRegex = /\b(\d+)[\.:\)]\s*(.+?)(?=\s*\b\d+[\.:\)]|\s*$)/gs;
    const matches = [...cleanContent.matchAll(numberedRegex)];
    
    if (matches.length > 0) {
        return matches.map(match => match[2].trim());
    }
    
    // If that fails, try to extract items with line breaks
    const lines = cleanContent.split(/\n+/).filter(line => line.trim().length > 0);
    if (lines.length >= count) {
        return lines.slice(0, count);
    }
    
    // If all else fails, just return the whole content as one item
    return [cleanContent];
}

// Enhanced applySeoMetadataToPost function for rank-math.js

/**
 * Apply SEO metadata to a WordPress post via Rank Math
 * @param {Object} wpConfig - WordPress configuration
 * @param {Object} seoMetadata - SEO metadata (title, description, permalink)
 * @param {number|string} postId - WordPress post ID
 * @returns {Object} WordPress API response
 */
async function applySeoMetadataToPost(wpConfig, seoMetadata, postId) {
    try {
        if (!wpConfig || !wpConfig.apiUrl || !seoMetadata || !postId) {
            throw new Error('Missing required parameters for applying SEO metadata');
        }
        
        console.log(`Applying SEO metadata to post ID: ${postId}`);
        
        // Check if this is a temporary ID
        if (typeof postId === 'string' && postId.startsWith('temp_')) {
            console.log('Post ID is temporary. Storing SEO metadata for later use.');
            return {
                success: true,
                message: 'SEO metadata stored for later use',
                isTemporary: true
            };
        }
        
        // Create auth header
        const authString = `${wpConfig.username}:${wpConfig.password}`;
        const encodedAuth = Buffer.from(authString).toString('base64');
        
        // Create a copy of the metadata to avoid modifying the original
        const metadataToSend = {...seoMetadata};
        
        // At the beginning of applySeoMetadataToPost function, after validation checks:
        if (seoMetadata.title && seoMetadata.title.includes('%title%')) {
            // Fetch the actual post title from WordPress
            try {
                const postResponse = await axios.get(
                    `${wpConfig.apiUrl}/posts/${postId}`,
                    {
                        headers: {
                            'Authorization': `Basic ${encodedAuth}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                
                // Use the actual post title for the %title% variable
                const postTitle = postResponse.data.title.rendered;
                console.log(`Using actual post title for SEO: "${postTitle}"`);
                
                // Store the original post title in the seoMetadata for reference
                seoMetadata._postTitle = postTitle;
            } catch (error) {
                console.log('Could not fetch post title:', error.message);
            }
        }
        
        // Process any template variables in the metadata
        if (seoMetadata.title && seoMetadata.title.includes('%')) {
            try {
                // Get post title for processing if available - use the one we already fetched if possible
                let articleTitle = seoMetadata._postTitle;
                if (!articleTitle) {
                    const postResponse = await axios.get(
                        `${wpConfig.apiUrl}/posts/${postId}`,
                        {
                            headers: {
                                'Authorization': `Basic ${encodedAuth}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    
                    articleTitle = postResponse.data.title.rendered || '';
                }
                const siteName = 'Recipe Elegance'; // Change to your site name
                
                // Process the template variables
                metadataToSend.title = wordpress.processSeoTemplate(
                    metadataToSend.title,
                    articleTitle,
                    siteName
                );
                
                console.log('Processed SEO title:', metadataToSend.title);
            } catch (error) {
                console.log('Could not fetch post title, using raw template');
                // Continue with the raw template, the WordPress plugin will handle it
            }
        }
        
        // Also process template variables in the description if present
        if (seoMetadata.description && seoMetadata.description.includes('%')) {
            try {
                // Use the post data we might have already fetched above
                if (!articleTitle) {
                    const postResponse = await axios.get(
                        `${wpConfig.apiUrl}/posts/${postId}`,
                        {
                            headers: {
                                'Authorization': `Basic ${encodedAuth}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    
                    const articleTitle = postResponse.data.title.rendered || '';
                    const siteName = 'Recipe Elegance'; // Change to your site name
                }
                
                // Process the template variables in description
                metadataToSend.description = wordpress.processSeoTemplate(
                    metadataToSend.description,
                    articleTitle,
                    siteName
                );
                
                console.log('Processed SEO description:', metadataToSend.description);
            } catch (error) {
                console.log('Could not process description template, using raw template');
                // Continue with the raw template
            }
        }
        
        // Update permalink if provided
        let permalinkUpdated = false;
        if (seoMetadata.permalink) {
            console.log(`Updating post permalink to: ${seoMetadata.permalink}`);
            
            // Clean up the permalink
            const cleanSlug = seoMetadata.permalink
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
            
            try {
                await axios.post(
                    `${wpConfig.apiUrl}/posts/${postId}`,
                    { slug: cleanSlug },
                    {
                        headers: {
                            'Authorization': `Basic ${encodedAuth}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                console.log(`✓ Post slug updated to: ${cleanSlug}`);
                permalinkUpdated = true;
            } catch (slugError) {
                console.error('Error updating slug:', slugError.message);
                // Continue with other updates even if slug update fails
            }
        }
        
        console.log('Updating SEO metadata...');
        
        try {
            // These are the meta field names that Rank Math uses
            const metaData = {
                'rank_math_title': metadataToSend.title || '',
                'rank_math_description': metadataToSend.description || '',
                'rank_math_focus_keyword': metadataToSend.keyword || '',
            };
            
            // Log the metadata being sent
            console.log('Setting Rank Math metadata:');
            console.log(JSON.stringify(metaData, null, 2));
            
            const metaResponse = await axios.post(
                `${wpConfig.apiUrl}/posts/${postId}`,
                { meta: metaData },
                {
                    headers: {
                        'Authorization': `Basic ${encodedAuth}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            console.log('✓ SEO metadata updated successfully');
            
            return {
                success: true,
                data: metaResponse.data
            };
            
        } catch (metaError) {
            console.error('Error updating post meta:', metaError.message);
            throw metaError;
        }
    } catch (error) {
        console.error('Error applying SEO metadata:', error);
        
        // Don't throw the error for temporary IDs
        if (typeof postId === 'string' && postId.startsWith('temp_')) {
            return {
                success: true,
                message: 'SEO metadata stored for later use (error handling)',
                isTemporary: true
            };
        }
        
        throw error;
    }
}

/**
 * Ensure SEO metadata matches article content
 * @param {Object} seoMetadata - Current SEO metadata
 * @param {Object} article - Article data with title and content
 * @returns {Object} - Updated SEO metadata that better matches the article
 */
function alignSeoMetadataWithArticle(seoMetadata, article) {
    if (!seoMetadata || !article) return seoMetadata;
    
    const updatedMetadata = {...seoMetadata};
    
    // Extract main topic from article title
    const articleTitle = article.title || '';
    const mainTopic = extractMainTopic(articleTitle);
    
    // Make sure the SEO title is related to the actual article
    // If SEO title seems unrelated, update it to use the article title
    const titleSimilarity = calculateSimilarityScore(
        seoMetadata.title.toLowerCase(), 
        articleTitle.toLowerCase()
    );
    
    if (titleSimilarity < 0.3) { // Threshold for similarity
        console.log('SEO title seems unrelated to article title, updating...');
        updatedMetadata.title = ensureUnderMaxLength(articleTitle, 60);
    }
    
    // Update permalink to match article content if needed
    // Only update if there's a significant mismatch
    if (mainTopic && !updatedMetadata.permalink.includes(mainTopic.toLowerCase())) {
        console.log('Permalink seems unrelated to article topic, updating...');
        const cleanMainTopic = mainTopic.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        
        updatedMetadata.permalink = cleanMainTopic;
    }
    
    return updatedMetadata;
}

/**
 * Extract the main topic from an article title
 * @param {string} title - Article title
 * @returns {string} - Main topic
 */
function extractMainTopic(title) {
    // Extract most significant nouns from the title
    const words = title.split(/\s+/);
    const foodKeywords = ['chicken', 'pizza', 'burger', 'recipe', 'pasta', 'cheese', 
                         'salad', 'soup', 'steak', 'beef', 'pork', 'fish'];
    
    for (const keyword of foodKeywords) {
        if (title.toLowerCase().includes(keyword)) {
            // Find compound words around this keyword
            const index = words.findIndex(w => 
                w.toLowerCase().includes(keyword) || keyword.includes(w.toLowerCase())
            );
            
            if (index !== -1) {
                // Get one word before and after if possible to get the full dish name
                const start = Math.max(0, index - 1);
                const end = Math.min(words.length, index + 2);
                return words.slice(start, end).join('-');
            }
            
            return keyword;
        }
    }
    
    // Fallback to first 2-3 words
    return words.slice(0, Math.min(3, words.length)).join('-');
}

/**
 * Calculate similarity between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity score (0-1)
 */
function calculateSimilarityScore(str1, str2) {
    const words1 = str1.split(/\s+/).filter(w => w.length > 3);
    const words2 = str2.split(/\s+/).filter(w => w.length > 3);
    
    let matches = 0;
    for (const word of words1) {
        if (words2.some(w => w.includes(word) || word.includes(w))) {
            matches++;
        }
    }
    
    return matches / Math.max(words1.length, 1);
}

/**
 * Ensure a string is under max length
 * @param {string} text - String to check
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} - Trimmed string if needed
 */
function ensureUnderMaxLength(text, maxLength) {
    if (text.length <= maxLength) return text;
    
    // Try to cut at a space to avoid cutting words
    let cutIndex = maxLength;
    while (cutIndex > 0 && text[cutIndex] !== ' ') {
        cutIndex--;
    }
    
    if (cutIndex === 0) cutIndex = maxLength;
    return text.substring(0, cutIndex).trim();
}

/**
 * Test the Rank Math API connection
 * @param {Object} wpConfig - WordPress configuration
 * @returns {boolean} True if connection successful
 */
async function testRankMathConnection(wpConfig) {
    try {
        console.log(`Testing Rank Math API connection...`);
        
        // Create auth header
        const authString = `${wpConfig.username}:${wpConfig.password}`;
        const encodedAuth = Buffer.from(authString).toString('base64');
        
        // Parse the API URL
        const parsedUrl = new URL(wpConfig.apiUrl);
        const baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
        
        // Test connection to the Rank Math API endpoint
        const response = await axios.get(
            `${baseUrl}/wp-json/rankmath/v1/getVersion`,
            {
                headers: {
                    'Authorization': `Basic ${encodedAuth}`
                }
            }
        );
        
        if (response.data && response.data.version) {
            console.log(`✓ Rank Math connection successful (version: ${response.data.version})`);
            return true;
        } else {
            console.log('✗ Rank Math connection test failed: Invalid response');
            return false;
        }
    } catch (error) {
        console.error('✗ Rank Math connection test failed:', error.message);
        return false;
    }
}

// Export all the functions
module.exports = {
    generateSeoMetadataOptions,
    extractNumberedItems,
    applySeoMetadataToPost,
    testRankMathConnection,
    alignSeoMetadataWithArticle,
    extractMainTopic,
    calculateSimilarityScore,
    ensureUnderMaxLength
};