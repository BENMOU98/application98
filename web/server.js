// web/server.js
//
// This is the main server file for the WordPress Automation web interface.
// It sets up an Express.js server that provides a web interface to manage
// the WordPress content automation platform.

// Load environment variables
require('dotenv').config();

// Import required modules - fixed duplicate declarations
const express = require('express');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs').promises;  // Use promise-based fs
const axios = require('axios');
const session = require('express-session');
const flash = require('connect-flash');
// 1. Add new imports at the top
const organizationModel = require('./models/organizations');
const registrationRoutes = require('./routes/registration-routes');


// Import our existing automation modules
const { config, validateConfig, saveConfig, loadConfig } = require('../src/config');
const { readKeywordsFromExcel, updateExcelWithPublicationStatus, addKeywordsToExcel } = require('../src/excel');
const { generateArticleContent } = require('../src/openai');
const { testWordPressConnection, publishToWordPress } = require('../src/wordpress');


// We'll move this debug middleware to after app initialization

// Add this AFTER importing routes but BEFORE using them
// Direct handler for recipe API test route that skips the normal route handler
//app.post('/api/test-recipe-api', (req, res) => {
  //console.log('[DIRECT HANDLER] Recipe API test request received');
  //res.json({ success: true, message: 'Recipe API connection successful (direct handler)' });
//});
// Import updated authentication middleware
const { 
  isAuthenticated, 
  isAdmin, 
  isEmployee, 
  isResourceOwner,
  attachUserToLocals,
  attachOrganizationToRequest,
  isSameOrganization
} = require('./middleware/auth');

// Import user model
const userModel = require('./models/users');

// Helper function for fs.existsSync since we're using promise-based fs
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Helper function to read file as string
async function readFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    throw error;
  }
}

// Helper function to write file
async function writeFile(filePath, content) {
  try {
    await fs.writeFile(filePath, content, 'utf8');
  } catch (error) {
    console.error(`Error writing file ${filePath}:`, error);
    throw error;
  }
}

// Create the Express application
const app = express();
const port = process.env.PORT || 5000;


// Debug middleware to log all requests
app.use((req, res, next) => {
  const originalSend = res.send;
  
  // Log request details
  console.log(`\n[DEBUG] ${new Date().toISOString()} - ${req.method} ${req.url}`);
  console.log('[DEBUG] Headers:', req.headers);
  
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('[DEBUG] Body:', JSON.stringify(req.body, null, 2));
  }
  
  // Intercept the send method to log response
  res.send = function(body) {
    // Log response (limit large responses)
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    console.log(`[DEBUG] Response (${res.statusCode}):`);
    console.log(bodyString.length > 500 ? bodyString.substring(0, 500) + '...' : bodyString);
    
    // Continue with the original send
    return originalSend.apply(this, arguments);
  };
  
  next();
});

const recipeApiRoutes = require('./routes/recipe-api-routes');

// Configure middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Add this after other app.use statements (around line 95)
app.use(recipeApiRoutes);

// Configure session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'wordpress-automation-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Configure flash messages
app.use(flash());

// Attach organization data first
app.use(attachOrganizationToRequest);

// Then attach user to locals (which now includes org data)
app.use(attachUserToLocals);

// Configure file uploads
const upload = multer({ dest: 'uploads/' });

// API endpoint to get article content by keyword - With ownership check
app.get('/api/article-content', isAuthenticated, async (req, res) => {
  try {
    const { keyword } = req.query;
    
    if (!keyword) {
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }
    
    console.log(`Getting article content for keyword: ${keyword}`);
    
    // Check if the keyword exists in Excel
    try {
      // Load the Excel file directly to avoid any potential issues with the utility function
      const workbook = XLSX.readFile(req.orgExcelFile);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      // Find the keyword
      const keywordRow = data.find(row => row[req.orgConfig.app.keywordColumn] === keyword);
      
      if (!keywordRow) {
        console.log(`Keyword "${keyword}" not found in Excel file`);
        return res.status(404).json({ success: false, error: 'Keyword not found in Excel file' });
      }
      
      // Check ownership for employees
      if (req.session.user.role === 'employee') {
        if (keywordRow.OwnerId && keywordRow.OwnerId !== req.session.user.id &&
            keywordRow.CreatedBy && keywordRow.CreatedBy !== req.session.user.id) {
          return res.status(403).json({ 
            success: false, 
            error: 'You do not have permission to access this content' 
          });
        }
      }
      
      console.log('Found keyword row:', keywordRow);
      
      // Try to get content from WordPress if Post ID exists
      if (keywordRow['Post ID']) {
        try {
          console.log(`Fetching content from WordPress for Post ID: ${keywordRow['Post ID']}`);
          
          // Create authentication header
          const authString = `${req.orgConfig.wordpress.username}:${req.orgConfig.wordpress.password}`;
          const encodedAuth = Buffer.from(authString).toString('base64');
          
          // Get post content from WordPress
          const response = await axios.get(`${req.orgConfig.wordpress.apiUrl}/posts/${keywordRow['Post ID']}`, {
            headers: {
              'Authorization': `Basic ${encodedAuth}`
            }
          });
          
          if (response.data && response.data.id) {
            console.log('Successfully retrieved content from WordPress');
            // Return the article content
            const article = {
              title: response.data.title.rendered || 'No Title',
              content: response.data.content.rendered || 'No Content'
            };
            
            return res.json({ success: true, article });
          }
        } catch (wpError) {
          console.error('Error fetching from WordPress:', wpError.message);
          // Continue to fallbacks below
        }
      } else {
        console.log('Post ID not found in Excel row');
      }
      
      // If we get here, try cache
      console.log('Trying cache...');
      // Check if a cached article exists for this keyword in session
    if (req.app.locals.cachedArticles && req.app.locals.cachedArticles[keyword]) {
      // Render preview with cached article
      return res.render('preview', {
        page: 'preview',
        keyword: keyword,
        article: req.app.locals.cachedArticles[keyword],
        seoMetadata: req.session.selectedSeoOption, // Add SEO metadata
        error: req.flash('error'),
        success: req.flash('success')
      });
    }
      
      // Last resort - create a simple dummy article
      console.log('No content found, returning dummy article');
      return res.json({
        success: true,
        article: {
          title: `Article about ${keyword}`,
          content: `<p>This article about "${keyword}" is published to WordPress, but the content cannot be retrieved.</p>
                   <p>You might need to view it directly on your WordPress site.</p>`
        },
        source: 'dummy'
      });
      
    } catch (excelError) {
      console.error('Error reading Excel file:', excelError);
      return res.status(500).json({ 
        success: false, 
        error: `Failed to read Excel file: ${excelError.message}` 
      });
    }
  } catch (error) {
    console.error('Error in article-content endpoint:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to delete article from history - With ownership check
app.post('/api/delete-article-history', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const { keyword } = req.body;
    
    if (!keyword) {
      console.log('No keyword provided for deletion');
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }
    
    console.log(`Deleting article history for keyword: ${keyword}`);
    
    try {
      // Read the Excel file
      const workbook = XLSX.readFile(req.orgExcelFile);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      // Find the keyword entry
      const keywordIndex = data.findIndex(row => row[req.orgConfig.app.keywordColumn] === keyword);
      
      if (keywordIndex === -1) {
        console.log(`Keyword "${keyword}" not found in Excel file`);
        return res.status(404).json({ success: false, error: 'Keyword not found in Excel file' });
      }
      
      // Check ownership for employees
      if (req.session.user.role === 'employee') {
        if (data[keywordIndex].OwnerId && data[keywordIndex].OwnerId !== req.session.user.id &&
            data[keywordIndex].CreatedBy && data[keywordIndex].CreatedBy !== req.session.user.id) {
          return res.status(403).json({
            success: false,
            error: 'You do not have permission to modify this article history'
          });
        }
      }
      
      console.log(`Found keyword at index ${keywordIndex}`);
      
      // Reset the status and publication data but keep the keyword
      const updatedRow = {};
      
      // Copy all fields from the original row
      Object.keys(data[keywordIndex]).forEach(key => {
        updatedRow[key] = data[keywordIndex][key];
      });
      
      // Override the fields we want to change
      updatedRow['Status'] = 'Pending';
      updatedRow['Publication Date'] = '';
      updatedRow['Post URL'] = '';
      updatedRow['Post ID'] = '';
      
      // Update the row
      data[keywordIndex] = updatedRow;
      
      // Write the updated data back to the Excel file
      const newWorksheet = XLSX.utils.json_to_sheet(data);
      workbook.Sheets[sheetName] = newWorksheet;
      XLSX.writeFile(workbook, req.orgExcelFile);
      
      console.log('Successfully reset keyword status to pending');
      
      // Remove from cache if it exists
      if (req.app.locals.cachedArticles && req.app.locals.cachedArticles[keyword]) {
        delete req.app.locals.cachedArticles[keyword];
        console.log('Removed from cache');
      }
      
      // Return success
      return res.json({ 
        success: true, 
        message: 'Article deleted from history successfully' 
      });
    } catch (excelError) {
      console.error('Error manipulating Excel file:', excelError);
      return res.status(500).json({ 
        success: false, 
        error: `Failed to update Excel file: ${excelError.message}` 
      });
    }
  } catch (error) {
    console.error('Error in delete-article-history endpoint:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

//====================================================
// AUTOMATION FUNCTIONS
//====================================================

// Function to process a single keyword
// Replace your existing processSingleKeyword function in server.js with this one:

// Function to process a single keyword with recipe support
async function processSingleKeyword(keywordRow, orgConfig, orgExcelFile) {
  try {
    const keyword = keywordRow[orgConfig.app.keywordColumn];
    
    // Update progress
    jobProgress.current = 0;
    jobProgress.currentKeyword = keyword;
    jobProgress.status = 'Processing';
    
    logProgress(`Processing keyword: "${keyword}"`);
    
    // Check if we should use prompts settings
    let promptSettings = null;
    
    if (orgConfig.prompts) {
      promptSettings = {
        useMultiPartGeneration: orgConfig.prompts.useMultiPartGeneration,
        mainPrompt: orgConfig.prompts.mainPrompt || orgConfig.app.contentTemplate,
        part1Prompt: orgConfig.prompts.part1Prompt,
        part2Prompt: orgConfig.prompts.part2Prompt,
        part3Prompt: orgConfig.prompts.part3Prompt,
        toneVoice: orgConfig.prompts.toneVoice,
        seoGuidelines: orgConfig.prompts.seoGuidelines,
        thingsToAvoid: orgConfig.prompts.thingsToAvoid
      };
    } else if (orgConfig.app.contentTemplate) {
      // Fallback to just using content template
      promptSettings = orgConfig.app.contentTemplate;
    }
    
    // Check if we should use recipe generation
    if (orgConfig.recipe && orgConfig.recipe.enabled) {
      logProgress(`Checking if keyword "${keyword}" qualifies for recipe generation...`);
      
      // Import the recipe helper
      const recipeHelper = require('../src/recipe-helper');
      
      // Check if this keyword should include a recipe
      if (recipeHelper.shouldAddRecipe(keyword, orgConfig.recipe)) {
        logProgress(`Keyword "${keyword}" qualifies for recipe generation`);
        
        // Use the enhanced article generation with recipe
        const { generateArticleWithRecipe } = require('../src/openai');
        
        // Generate article with recipe
        const result = await generateArticleWithRecipe(
          orgConfig.openai,
          orgConfig.wordpress,
          orgConfig.recipe,
          keyword,
          orgConfig.app.minWords,
          promptSettings
        );
        
        if (result.success) {
          // Update Excel with publication status directly from the result
          const publishData = {
            postId: result.postId,
            postUrl: result.postUrl,
            status: 'Published',
            publishDate: new Date().toISOString().split('T')[0]
          };
          
          updateExcelWithPublicationStatus(orgExcelFile, keywordRow, publishData);
          
          // Log success with info about recipe
          const recipeMsg = result.recipeAdded ? ' (with recipe)' : '';
          logProgress(`✓ Published "${keyword}"${recipeMsg} successfully as ${orgConfig.app.publishStatus}`);
        } else {
          throw new Error(result.error || 'Unknown error in article generation with recipe');
        }
      } else {
        // Normal article generation (no recipe)
        logProgress(`Keyword "${keyword}" does not qualify for recipe generation, proceeding with normal article generation`);
        
        // Generate regular article content
        const article = await generateArticleContent(
          orgConfig.openai, 
          keyword, 
          orgConfig.app.minWords,
          promptSettings
        );
        
        // Publish to WordPress
        const publishData = await publishToWordPress(
          orgConfig.wordpress,
          article,
          keyword,
          orgConfig.app.publishStatus
        );
        
        // Update Excel with publication status
        updateExcelWithPublicationStatus(orgExcelFile, keywordRow, publishData);
        
        // Log success
        logProgress(`✓ Published "${keyword}" successfully as ${orgConfig.app.publishStatus}`);
      }
    } else {
      // Recipe generation is not enabled, proceed with normal article generation
      logProgress(`Generating content for "${keyword}"...`);
      
      // Generate regular article content
      const article = await generateArticleContent(
        orgConfig.openai, 
        keyword, 
        orgConfig.app.minWords,
        promptSettings
      );
      
      // Publish to WordPress
      const publishData = await publishToWordPress(
        orgConfig.wordpress,
        article,
        keyword,
        orgConfig.app.publishStatus
      );
      
      // Update Excel with publication status
      updateExcelWithPublicationStatus(orgExcelFile, keywordRow, publishData);
      
      // Log success
      logProgress(`✓ Published "${keyword}" successfully as ${orgConfig.app.publishStatus}`);
    }
    
    // Update progress
    jobProgress.current = 1;
    jobProgress.status = 'Completed';
    
    return true;
  } catch (error) {
    // Log error with an X mark
    logProgress(`✗ Failed to process "${keywordRow[orgConfig.app.keywordColumn]}": ${error.message}`);
    throw error;
  }
}

// Function to run the automation
async function runAutomation(keywordFilter = null, orgConfig, orgExcelFile) {
  try {
    // Read keywords from Excel
    let keywordRows = readKeywordsFromExcel(orgExcelFile, orgConfig.app.keywordColumn);
    
    // Apply filter if provided (for employee access)
    if (keywordFilter) {
      keywordRows = keywordRows.filter(keywordFilter);
    }
    
    if (keywordRows.length === 0) {
      logProgress('No pending keywords found in Excel file. Nothing to do.');
      return;
    }
    
    // Update progress info
    jobProgress.total = keywordRows.length;
    jobProgress.current = 0;
    jobProgress.status = 'Processing keywords';
    
    // Track success and failures
    let successCount = 0;
    let failureCount = 0;
    
    // Start with a summary log
    logProgress(`Started processing ${keywordRows.length} keywords`);
    
    // Process each keyword
    for (let i = 0; i < keywordRows.length; i++) {
      const keywordRow = keywordRows[i];
      const keyword = keywordRow[orgConfig.app.keywordColumn];
      
      // Update progress
      jobProgress.current = i + 1;
      jobProgress.currentKeyword = keyword;
      
      // Log in a simplified format
      logProgress(`Processing: "${keyword}" (${i + 1}/${keywordRows.length})`);
      
      try {
        // Generate article content
        logProgress(`Generating content for "${keyword}"...`);
        
        // Check if we should use prompts settings
        let promptSettings = null;
        
        if (orgConfig.prompts) {
          promptSettings = {
            useMultiPartGeneration: orgConfig.prompts.useMultiPartGeneration,
            mainPrompt: orgConfig.prompts.mainPrompt || orgConfig.app.contentTemplate,
            part1Prompt: orgConfig.prompts.part1Prompt,
            part2Prompt: orgConfig.prompts.part2Prompt,
            part3Prompt: orgConfig.prompts.part3Prompt,
            toneVoice: orgConfig.prompts.toneVoice,
            seoGuidelines: orgConfig.prompts.seoGuidelines,
            thingsToAvoid: orgConfig.prompts.thingsToAvoid
          };
        } else if (orgConfig.app.contentTemplate) {
          // Fallback to just using content template
          promptSettings = orgConfig.app.contentTemplate;
        }
        
        const article = await generateArticleContent(
          orgConfig.openai, 
          keyword, 
          orgConfig.app.minWords,
          promptSettings
        );
        
        // Publish to WordPress
        logProgress(`Publishing "${keyword}" to WordPress...`);
        const publishData = await publishToWordPress(
          orgConfig.wordpress,
          article,
          keyword,
          orgConfig.app.publishStatus
        );
        
        // Update Excel with publication status
        updateExcelWithPublicationStatus(orgExcelFile, keywordRow, publishData);
        
        // Log success with a checkmark
        logProgress(`✓ Published "${keyword}" successfully as ${orgConfig.app.publishStatus}`);
        successCount++;
        
        // Add a delay between keywords
        if (i < keywordRows.length - 1) {
          logProgress(`Waiting before next keyword...`);
          await new Promise(resolve => setTimeout(resolve, orgConfig.app.delayBetweenPosts));
        }
      } catch (error) {
        // Log error with an X mark
        logProgress(`✗ Failed to process "${keyword}": ${error.message}`);
        failureCount++;
        // Continue with next keyword
      }
    }
    
    // Log completion summary
    logProgress(`Automation completed: ${successCount} published, ${failureCount} failed`);
  } catch (error) {
    logProgress(`Automation failed: ${error.message}`);
    throw error;
  }
}

// Ensure data directory exists before starting
async function initializeApp() {
  try {
    // Create data directory if it doesn't exist
    const dataDir = path.join(__dirname, '../data');
    try {
      await fs.mkdir(dataDir, { recursive: true });
      console.log('Data directory initialized');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    
    // Create users.json file with default admin user if it doesn't exist
    await ensureUsersFileExists();
    console.log('User authentication system initialized');
    
    // Initialize ownership for existing keywords if Excel file exists
    try {
      if (await fileExists(config.app.excelFile)) {
        // Get admin user ID
        const users = await getAllUsers();
        const adminUser = users.find(user => user.role === 'admin');
        
        if (adminUser) {
          await userModel.initializeKeywordOwnership(config.app.excelFile, config.app.keywordColumn, adminUser.id);
        }
      }
    } catch (ownershipError) {
      console.warn('Error initializing keyword ownership:', ownershipError);
      // Continue without failing - application will still work
    }
  } catch (error) {
    console.error('Error initializing app:', error);
    throw error;
  }
}

// Admin employee dashboard route for monitoring employee activities
app.get('/admin/employee-dashboard', isAuthenticated, isAdmin, async (req, res) => {
  try {
    // Get employees from the same organization
  const allUsers = await userModel.getUsersByOrganization(req.session.user.organizationId);
  const employees = allUsers.filter(user => user.role === 'employee');
    
    // Optional: Get selected employee ID from query params
    const selectedEmployeeId = req.query.employeeId || '';
    let selectedEmployee = null;
    let keywords = [];
    let publications = [];
    let activityLog = [];
    let stats = {
      totalKeywords: 0,
      publishedKeywords: 0,
      pendingKeywords: 0,
      todayActivity: 0
    };
    
    // If an employee is selected, get their data
    if (selectedEmployeeId) {
      // Find selected employee
      selectedEmployee = employees.find(emp => emp.id === selectedEmployeeId);
      
      if (selectedEmployee) {
        // Get employee's keywords
        const excelFileExists = await fileExists(req.orgExcelFile);

if (excelFileExists) {
  const workbook = XLSX.readFile(req.orgExcelFile);
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(worksheet);
          
          // Filter data for the selected employee
          keywords = data.filter(row => 
            row.OwnerId === selectedEmployeeId || row.CreatedBy === selectedEmployeeId
          );
          
          // Filter for published articles
          publications = keywords.filter(row => row.Status === 'Published');
          
          // Calculate statistics
          stats.totalKeywords = keywords.length;
          stats.publishedKeywords = publications.length;
          stats.pendingKeywords = keywords.filter(row => 
            row.Status === 'Pending' || !row.Status || row.Status === ''
          ).length;
          
          // Create dummy activity log for now (can be replaced with actual logging system)
          // In a real implementation, you would read from a proper activity log
          activityLog = createDummyActivityLog(keywords, publications, selectedEmployeeId, req.orgConfig.app.keywordColumn);
          
          // Count today's activity
          const today = new Date().toISOString().split('T')[0]; // Get YYYY-MM-DD
          stats.todayActivity = activityLog.filter(log => 
            log.timestamp.startsWith(today)
          ).length;
        }
      }
    }
    
    // Render the employee dashboard view
    res.render('employee-dashboard', {
      page: 'employee-dashboard',
      employees,
      selectedEmployeeId,
      selectedEmployee,
      keywords,
      publications,
      activityLog,
      stats,
      keywordColumn: req.orgConfig.app.keywordColumn,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (error) {
    console.error('Error loading employee dashboard:', error);
    req.flash('error', 'Error loading employee dashboard: ' + error.message);
    res.redirect('/');
  }
});

// Helper function to create dummy activity log for demo purposes
// This would be replaced with real logging in a production system
function createDummyActivityLog(keywords, publications, employeeId, keywordColumn) {
  const log = [];
  
  // Add keyword creation log entries
  keywords.forEach(keyword => {
    if (keyword.CreatedBy === employeeId) {
      log.push({
        type: 'info',
        timestamp: keyword.CreatedAt || new Date().toISOString(),
       // You need to pass keywordColumn as a parameter to this function
        // Update function call in employee-dashboard route
        message: `Created keyword: "${keyword[keywordColumn]}"`
      });
    }
  });
  
  // Add publication log entries
  publications.forEach(pub => {
    log.push({
      type: 'success',
      timestamp: pub['Publication Date'] || new Date().toISOString(),
      message: `Published article for: "${pub[keywordColumn]}"`
    });
  });
  
  // Sort by timestamp (newest first)
  return log.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// Add this new route to server.js
// This route is specifically for the admin to view articles from the employee dashboard
app.get('/admin/view-article/:keyword/:userId', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const keyword = req.params.keyword;
    const userId = req.params.userId;
    
    console.log(`Admin viewing article for keyword: "${keyword}" by user ID: ${userId}`);
    
    // Load the Excel file
    const workbook = XLSX.readFile(req.orgExcelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Find the specific keyword for the specific user
    const keywordRow = data.find(row => 
      row[req.orgConfig.app.keywordColumn] === keyword && 
      (row.OwnerId === userId || row.CreatedBy === userId)
    );
    
    if (!keywordRow) {
      req.flash('error', `Article for keyword "${keyword}" by this employee not found`);
      return res.redirect('/admin/employee-dashboard');
    }
    
    // Try to get content from WordPress if Post ID exists
    if (keywordRow['Post ID']) {
      try {
        console.log(`Fetching content from WordPress for Post ID: ${keywordRow['Post ID']}`);
        
        // Create authentication header
        const authString = `${req.orgConfig.wordpress.username}:${req.orgConfig.wordpress.password}`;
        const encodedAuth = Buffer.from(authString).toString('base64');
        
        // Get post content from WordPress
        const response = await axios.get(`${req.orgConfig.wordpress.apiUrl}/posts/${keywordRow['Post ID']}`, {
          headers: {
            'Authorization': `Basic ${encodedAuth}`
          }
        });
        
        if (response.data && response.data.id) {
          console.log('Successfully retrieved content from WordPress');
          
          // Create article object
          const article = {
            title: response.data.title.rendered || 'No Title',
            content: response.data.content.rendered || 'No Content'
          };
          
          // Render the preview page
          return res.render('article-view', {
            page: 'article-view',
            keyword: keyword,
            article: article,
            employeeId: userId,
            isAdmin: true,
            error: req.flash('error'),
            success: req.flash('success')
          });
        }
      } catch (wpError) {
        console.error('Error fetching from WordPress:', wpError.message);
        // Continue to fallbacks below
      }
    }
    
    // If we couldn't get content from WordPress, show error
    req.flash('error', 'Could not retrieve article content. The post may no longer exist in WordPress.');
    return res.redirect('/admin/employee-dashboard?employeeId=' + userId);
    
  } catch (error) {
    console.error('Error viewing article:', error);
    req.flash('error', 'Error viewing article: ' + error.message);
    return res.redirect('/admin/employee-dashboard');
  }
});

// Add migration function for existing users
async function migrateExistingData() {
  try {
    // Check if migration is needed
    const users = await userModel.getAllUsers();
    const organizations = await organizationModel.getAllOrganizations();
    
    if (organizations.length === 0 && users.length > 0) {
      // Create default organization for existing admin
      const adminUser = users.find(user => user.role === 'admin');
      
      if (adminUser) {
        const org = await organizationModel.createOrganization({
          name: 'Default Organization',
          adminId: adminUser.id
        });
        
        // Update all users with the default organization
        for (const user of users) {
          user.organizationId = org.id;
        }
        
        // Save updated users
        await userModel.saveUsers(users);  // Make sure this is userModel.saveUsers, not local saveUsers
        
        // Copy existing config and Excel file to organization-specific files
        const dataDir = path.join(__dirname, '../data');
        
        // Copy config
        if (await fileExists(path.join(dataDir, 'config.json'))) {
          await fs.copyFile(
            path.join(dataDir, 'config.json'),
            path.join(dataDir, org.configFile)
          );
        }
        
        // Copy Excel file
        if (await fileExists(config.app.excelFile)) {
          await fs.copyFile(
            config.app.excelFile,
            path.join(dataDir, org.excelFile)
          );
        }
        
        console.log('Migration completed successfully');
      }
    }
  } catch (error) {
    console.error('Error during migration:', error);
  }
}

async function startServer() {
  try {
    // Run migration first
    await migrateExistingData();
    
    // Load configuration from file
    await loadConfig();
    
    // Continue with existing initialization
    await initializeApp();
    
    const port = process.env.PORT || 5000;
    
    app.listen(port, '0.0.0.0', () => {
      console.log(`WordPress Automation web app running at http://localhost:${port}`);
      console.log(`New users can register at http://localhost:${port}/register`);
    });
  } catch (error) {
    console.error('ERROR STARTING SERVER:', error);
  }
}
startServer();

// Track running job
let isJobRunning = false;
let jobProgress = {
  total: 0,
  current: 0,
  currentKeyword: '',
  status: '',
  log: []
};

// Helper function to log progress (simplified activity logging)
function logProgress(message) {
  const timestamp = new Date().toLocaleTimeString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  
  // Add to the job progress log
  jobProgress.log.push(logMessage);
  
  // Keep log size reasonable
  if (jobProgress.log.length > 50) {
    jobProgress.log.shift();
  }
}

//====================================================
// USER MANAGEMENT
//====================================================

// File to store user data
const USERS_FILE = path.join(__dirname, '../data/users.json');

// Create data directory and users file if they don't exist
async function ensureUsersFileExists() {
  try {
    const dataDir = path.join(__dirname, '../data');
    
    // Create data directory if it doesn't exist
    try {
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    
    // Check if users file exists
    try {
      await fs.access(USERS_FILE);
    } catch (error) {
      // Create the file with default admin user
      const crypto = require('crypto');
      const adminUser = {
        id: crypto.randomBytes(16).toString('hex'),
        username: 'admin',
        // Default password: admin123
        password: crypto.createHash('sha256').update('admin123').digest('hex'),
        name: 'Administrator',
        email: 'admin@example.com',
        role: 'admin',
        createdAt: new Date().toISOString()
      };
      
      await writeFile(USERS_FILE, JSON.stringify({ users: [adminUser] }, null, 2));
      console.log('Created users file with default admin user');
    }
  } catch (error) {
    console.error('Error ensuring users file exists:', error);
    throw error;
  }
}

// Load all users
async function getAllUsers() {
  await ensureUsersFileExists();
  
  try {
    const data = await readFile(USERS_FILE, 'utf8');
    return JSON.parse(data).users;
  } catch (error) {
    console.error('Error loading users:', error);
    return [];
  }
}

// Save all users
async function saveUsers(users) {
  try {
    await writeFile(USERS_FILE, JSON.stringify({ users }, null, 2));
  } catch (error) {
    console.error('Error saving users:', error);
    throw error;
  }
}

// Hash password
function hashPassword(password) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Generate user ID
function generateId() {
  const crypto = require('crypto');
  return crypto.randomBytes(16).toString('hex');
}

// Authenticate user
async function authenticateUser(username, password) {
  const users = await getAllUsers();
  const user = users.find(user => 
    user.username === username && user.password === hashPassword(password)
  );
  
  if (!user) return null;
  
  // Return user without password
  const { password: _, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

// Delete user
async function deleteUser(id) {
  const users = await getAllUsers();
  const index = users.findIndex(user => user.id === id);
  
  if (index === -1) {
    throw new Error('User not found');
  }
  
  // Remove user
  const deletedUser = users.splice(index, 1)[0];
  
  // Save to file
  await saveUsers(users);
  
  // Return user without password
  const { password, ...userWithoutPassword } = deletedUser;
  return userWithoutPassword;
}

//====================================================
// AUTHENTICATION ROUTES
//====================================================

app.use('/', registrationRoutes);

// Login page
app.get('/login', (req, res) => {
  // Redirect if already logged in
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  
  res.render('login', {
    page: 'login',
    error: req.flash('error'),
    success: req.flash('success')
  });
});

// Login form submission
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      req.flash('error', 'Please provide both username and password');
      return res.redirect('/login');
    }
    
    // Authenticate user
    const user = await userModel.authenticateUser(username, password);    
    if (!user) {
      req.flash('error', 'Invalid username or password');
      return res.redirect('/login');
    }
    
    // Set user in session
    req.session.user = user;
    
    // Redirect to saved returnTo URL or dashboard
    const returnUrl = req.session.returnTo || '/';
    delete req.session.returnTo;
    
    res.redirect(returnUrl);
  } catch (error) {
    console.error('Login error:', error);
    req.flash('error', 'Login failed: ' + error.message);
    res.redirect('/login');
  }
});

// Logout
app.get('/logout', (req, res) => {
  // Destroy session
  req.session.destroy(err => {
    if (err) {
      console.error('Error during logout:', err);
    }
    res.redirect('/login');
  });
});

// User management page (admin only)
app.get('/users', isAuthenticated, isAdmin, async (req, res) => {
  try {
    // Get only users from the same organization
    const users = await userModel.getUsersByOrganization(req.session.user.organizationId);
    
    res.render('users', {
      page: 'users',
      users,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (error) {
    console.error('Error loading users page:', error);
    req.flash('error', 'Failed to load users: ' + error.message);
    res.redirect('/');
  }
});

// Create user (admin only)
app.post('/users', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { username, password, name, email, role } = req.body;
    
    // Validate required fields
    if (!username || !password || !name || !email || !role) {
      req.flash('error', 'All fields are required');
      return res.redirect('/users');
    }
    
    // Create user with organizationId using userModel
    await userModel.createUser({  // Make sure you're using userModel.createUser, not the local createUser
      username,
      password,
      name,
      email,
      role,
      organizationId: req.session.user.organizationId // Add organization ID from current admin
    });
    
    req.flash('success', 'User created successfully');
    res.redirect('/users');
  } catch (error) {
    console.error('Error creating user:', error);
    req.flash('error', 'Failed to create user: ' + error.message);
    res.redirect('/users');
  }
});

// Update user (admin only)
app.post('/users/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, password } = req.body;
    
    // Validate required fields
    if (!name || !email || !role) {
      req.flash('error', 'Name, email and role are required');
      return res.redirect('/users');
    }
    
    // Update data
    const updateData = { name, email, role };
    
    // Add password if provided
    if (password) {
      updateData.password = password;
    }
    
    // Update user
    await userModel.updateUser(id, updateData);
    
    req.flash('success', 'User updated successfully');
    res.redirect('/users');
  } catch (error) {
    console.error('Error updating user:', error);
    req.flash('error', 'Failed to update user: ' + error.message);
    res.redirect('/users');
  }
});

// Delete user (admin only)
app.post('/users/:id/delete', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Don't allow deleting own account
    if (id === req.session.user.id) {
      req.flash('error', 'You cannot delete your own account');
      return res.redirect('/users');
    }
    
    // Delete user
    await userModel.deleteUser(id);

    
    req.flash('success', 'User deleted successfully');
    res.redirect('/users');
  } catch (error) {
    console.error('Error deleting user:', error);
    req.flash('error', 'Failed to delete user: ' + error.message);
    res.redirect('/users');
  }
});

// My profile page
app.get('/profile', isAuthenticated, (req, res) => {
  res.render('profile', {
    page: 'profile',
    error: req.flash('error'),
    success: req.flash('success')
  });
});

// Update profile
app.post('/profile', isAuthenticated, async (req, res) => {
  try {
    const { name, email, currentPassword, newPassword } = req.body;
    
    // Validate required fields
    if (!name || !email) {
      req.flash('error', 'Name and email are required');
      return res.redirect('/profile');
    }
    
    // Update data
    const updateData = { name, email };
    
    // If changing password, validate current password
    if (newPassword) {
      if (!currentPassword) {
        req.flash('error', 'Current password is required to set a new password');
        return res.redirect('/profile');
      }
      
      // Get all users to verify password
      const users = await getAllUsers();
      const user = users.find(u => u.id === req.session.user.id);
      
      if (!user || user.password !== hashPassword(currentPassword)) {
        req.flash('error', 'Current password is incorrect');
        return res.redirect('/profile');
      }
      
      // Password is correct, update it
      updateData.password = newPassword;
    }
    
    // Update user
    const updatedUser = await userModel.updateUser(req.session.user.id, updateData);
    
    // Update session
    req.session.user = updatedUser;
    
    req.flash('success', 'Profile updated successfully');
    res.redirect('/profile');
  } catch (error) {
    console.error('Error updating profile:', error);
    req.flash('error', 'Failed to update profile: ' + error.message);
    res.redirect('/profile');
  }
});

//====================================================
// UPDATED PAGE ROUTES WITH ACCESS CONTROL
//====================================================

// Home page route - Requires authentication and filters data for employees
app.get('/', isAuthenticated, isResourceOwner, async (req, res) => {
  // Use req.orgConfig instead of config
  const configValid = validateConfig(req.orgConfig);
  
  // Check connection to WordPress only if config is valid
  let wpConnectionStatus = false;
  if (configValid) {
    try {
      wpConnectionStatus = await testWordPressConnection(req.orgConfig.wordpress);
    } catch (error) {
      console.error('Error testing WordPress connection:', error.message);
    }
  }
  
  // Check if keywords file exists
  const excelFileExists = await fileExists(req.orgExcelFile);
  
  // For regular employees, only pass their own job progress data
  let filteredJobProgress = jobProgress;
  
  if (req.session.user.role === 'employee' && req.ownerId) {
    // Filter job progress for specific user if needed
  }
  
  res.render('index', {
    page: 'home',
    configValid,
    wpConnectionStatus,
    excelFileExists,
    isJobRunning,
    jobProgress: filteredJobProgress,
    config: req.orgConfig, // Use org-specific config instead of global config
    error: req.flash('error'),
    success: req.flash('success')
  });
});

// Keywords page route - Requires authentication with resource ownership check
app.get('/keywords', isAuthenticated, isResourceOwner, async (req, res) => {
  let keywords = [];
  let error = null;
  
  // Check if Excel file exists and load keywords
  const excelFileExists = await fileExists(req.orgExcelFile);
  
  if (excelFileExists) {
    try {
      const allKeywords = readKeywordsFromExcel(req.orgExcelFile, req.orgConfig.app.keywordColumn);
      
      // For employees, filter keywords to only show their own
      if (req.session.user.role === 'employee' && req.ownerId) {
        keywords = allKeywords.filter(keyword => {
          return keyword.CreatedBy === req.ownerId || keyword.OwnerId === req.ownerId;
        });
      } else {
        keywords = allKeywords;
      }
    } catch (err) {
      error = `Error reading Excel file: ${err.message}`;
    }
  } else {
    error = `Excel file not found at: ${req.orgExcelFile}`;
  }
  
  res.render('keywords', {
    page: 'keywords',
    keywords,
    error: error || req.flash('error'),
    success: req.flash('success'),
    excelFile: req.orgExcelFile,
    keywordColumn: req.orgConfig.app.keywordColumn
  });
});

// History page route - Requires authentication with resource ownership check
app.get('/history', isAuthenticated, isResourceOwner, async (req, res) => {
  let publications = [];
  let error = null;
  
  // Read all data from Excel including published articles
  const excelFileExists = await fileExists(req.orgExcelFile);
  
  if (excelFileExists) {
    try {
      const workbook = XLSX.readFile(req.orgExcelFile);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      // Filter published articles
      let allPublications = data.filter(row => row.Status === 'Published');
      
      // Filter publications for employees to only show their own
      if (req.session.user.role === 'employee' && req.ownerId) {
        // Only show publications created by this employee
        publications = allPublications.filter(pub => {
          return pub.CreatedBy === req.ownerId || pub.OwnerId === req.ownerId;
        });
      } else {
        // For admins, show all publications
        publications = allPublications;
      }
      
      // Make sure the keyword column is accessible as 'Keyword'
      publications = publications.map(row => {
        // If the keyword column name is different from 'Keyword', create an alias
        if (req.orgConfig.app.keywordColumn !== 'Keyword' && row[req.orgConfig.app.keywordColumn]) {
          row['Keyword'] = row[req.orgConfig.app.keywordColumn];
        }
        return row;
      });
      
      // Set error to null explicitly
      error = null;
    } catch (err) {
      error = `Error reading Excel file: ${err.message}`;
    }
  } else {
    error = `Excel file not found at: ${req.orgExcelFile}`;
  }
  
  res.render('history', {
    page: 'history',
    publications: publications || [],
    error: typeof error === 'string' ? error : null,
    success: req.flash('success'),
    config: req.orgConfig // Pass org config to the view instead of global config
  });
});

app.get('/settings', isAuthenticated, isAdmin, async (req, res) => {
  // Ensure recipe settings exist with default values if not present
  if (!req.orgConfig.recipe) {
    req.orgConfig.recipe = {
      apiKey: '',
      enabled: false,
      keywords: 'food, recipe, cooking, dish, meal'
    };
  }
  
  res.render('settings', {
    page: 'settings',
    config: req.orgConfig,
    error: req.flash('error'),
    success: req.flash('success')
  });
});

// Prompt settings page route - Requires authentication
app.get('/prompt-settings', isAuthenticated, (req, res) => {
  try {
    // Make sure config.prompts exists
    if (!req.orgConfig.prompts) {
      req.orgConfig.prompts = {
        useMultiPartGeneration: false,
        mainPrompt: req.orgConfig.app.contentTemplate || "",
        part1Prompt: "",
        part2Prompt: "",
        part3Prompt: "",
        toneVoice: "",
        seoGuidelines: "",
        thingsToAvoid: ""
      };
    }
    
    res.render('prompt-settings', {
      page: 'prompt-settings',
      config: req.orgConfig,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (error) {
    console.error('Error rendering prompt settings page:', error);
    req.flash('error', 'Error loading prompt settings: ' + error.message);
    res.redirect('/');
  }
});

// Route to handle the article preview page - Requires authentication
app.get('/preview/:keyword', isAuthenticated, async (req, res) => {
  try {
    const keyword = req.params.keyword;
    console.log(`Preview requested for keyword: "${keyword}"`);
    
    // Load the Excel file
    const workbook = XLSX.readFile(req.orgExcelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Find all rows with this keyword (may be owned by different users)
    const keywordRows = data.filter(row => row[req.orgConfig.app.keywordColumn] === keyword);
    
    if (keywordRows.length === 0) {
      console.log(`Keyword "${keyword}" not found in Excel file`);
      req.flash('error', `Keyword "${keyword}" not found in Excel file`);
      return res.redirect('/keywords');
    }
    
    let keywordRow = null;
    
    // For employees, find their own keyword
    if (req.session.user.role === 'employee') {
      keywordRow = keywordRows.find(row => 
        row.OwnerId === req.session.user.id || row.CreatedBy === req.session.user.id
      );
      
      if (!keywordRow) {
        req.flash('error', 'You do not have permission to view this keyword');
        return res.redirect('/keywords');
      }
    } else {
      // For admins, just use the first match (or could add a user parameter to select which employee's version)
      keywordRow = keywordRows[0];
    }
    
    // Check if a cached article exists for this keyword in session
    if (req.app.locals.cachedArticles && req.app.locals.cachedArticles[keyword]) {
      // Render preview with cached article
      return res.render('preview', {
        page: 'preview',
        keyword: keyword,
        article: req.app.locals.cachedArticles[keyword],
        error: req.flash('error'),
        success: req.flash('success')
      });
    }
    
    // Try to get content from WordPress if Post ID exists
    if (keywordRow['Post ID']) {
      try {
        console.log(`Fetching content from WordPress for Post ID: ${keywordRow['Post ID']}`);
        
        // Create authentication header
        const authString = `${req.orgConfig.wordpress.username}:${req.orgConfig.wordpress.password}`;
        const encodedAuth = Buffer.from(authString).toString('base64');
        
        // Get post content from WordPress
        const response = await axios.get(`${req.orgConfig.wordpress.apiUrl}/posts/${keywordRow['Post ID']}`, {
          headers: {
            'Authorization': `Basic ${encodedAuth}`
          }
        });
        
        if (response.data && response.data.id) {
          console.log('Successfully retrieved content from WordPress');
          // Cache the article
          if (!req.app.locals.cachedArticles) {
            req.app.locals.cachedArticles = {};
          }
          req.app.locals.cachedArticles[keyword] = {
            title: response.data.title.rendered || 'No Title',
            content: response.data.content.rendered || 'No Content'
          };
          
          // Render preview with WordPress article
          return res.render('preview', {
            page: 'preview',
            keyword: keyword,
            article: req.app.locals.cachedArticles[keyword],
            error: req.flash('error'),
            success: req.flash('success')
          });
        }
      } catch (wpError) {
        console.error('Error fetching from WordPress:', wpError.message);
        // Continue to generate a new preview
      }
    }
    
    // If no cached article or WordPress content, generate one
    // Initialize app.locals.cachedArticles if it doesn't exist
    if (!req.app.locals.cachedArticles) {
      req.app.locals.cachedArticles = {};
    }
    
    // Show generation is not yet started
    return res.redirect(`/generate-preview/${encodeURIComponent(keyword)}`);
    
  } catch (error) {
    console.error('Error rendering preview page:', error);
    req.flash('error', 'Error rendering preview page: ' + error.message);
    return res.redirect('/keywords');
  }
});

// Route to generate content for preview - Requires authentication
app.get('/generate-preview/:keyword', isAuthenticated, async (req, res) => {
  try {
    const keyword = req.params.keyword;
    console.log(`Generating preview for keyword: "${keyword}"`);
    
    // Render a loading page that will trigger content generation
    res.render('generate', {
      page: 'generate',
      keyword: keyword,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (error) {
    console.error('Error rendering generation page:', error);
    req.flash('error', 'Error rendering generation page: ' + error.message);
    res.redirect('/keywords');
  }
});

//====================================================
// UPDATED API ROUTES WITH OWNERSHIP CHECKS
//====================================================

// API endpoint to test WordPress connection with provided credentials - Admin only
app.post('/api/test-connection', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { apiUrl, username, password } = req.body;
    
    if (!apiUrl || !username || !password) {
      return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }
    
    // Create authentication header
    const authString = `${username}:${password}`;
    const encodedAuth = Buffer.from(authString).toString('base64');
    
    // Try to get current user info
    const response = await axios.get(`${apiUrl}/users/me`, {
      headers: {
        'Authorization': `Basic ${encodedAuth}`
      }
    });
    
    // Check if response contains user data
    if (response.data && response.data.id) {
      res.json({
        success: true,
        user: response.data
      });
    } else {
      res.json({
        success: false, 
        error: 'Connection successful but user data is incomplete or missing'
      });
    }
  } catch (error) {
    let errorMessage = 'Connection failed';
    
    if (error.response) {
      errorMessage = `Connection failed: ${error.response.status} - ${error.response.statusText}`;
      if (error.response.data && error.response.data.message) {
        errorMessage += ` (${error.response.data.message})`;
      }
    } else if (error.message) {
      errorMessage = `Connection failed: ${error.message}`;
    }
    
    res.json({
      success: false,
      error: errorMessage
    });
  }
});

// API endpoint to test OpenAI API connection - Admin only
app.post('/api/test-openai', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { apiKey, model } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'API key is required' });
    }
    
    // Initialize OpenAI client with the provided API key
    const { OpenAI } = require('openai');
    const openai = new OpenAI({
      apiKey: apiKey,
    });
    
    // Test the API with a simple completion
    const testModel = model || 'gpt-3.5-turbo';
    const response = await openai.chat.completions.create({
      model: testModel,
      messages: [
        { role: "system", content: "You are a test assistant." },
        { role: "user", content: "Return only the text 'OpenAI API connection successful' if you receive this message." }
      ],
      max_tokens: 20,
      temperature: 0,
    });
    
    // Check if we got a valid response
    if (response && response.choices && response.choices.length > 0) {
      const content = response.choices[0].message.content.trim();
      
      // Return success response with model information
      res.json({
        success: true,
        model: testModel,
        message: 'OpenAI API connection successful',
        response: content
      });
    } else {
      res.json({
        success: false,
        error: 'Received an empty or invalid response from OpenAI'
      });
    }
  } catch (error) {
    // Format the error message
    let errorMessage = 'OpenAI API connection failed';
    
    if (error.response) {
      // API returned an error
      const status = error.response.status;
      const data = error.response.data;
      
      if (status === 401) {
        errorMessage = 'Authentication error: Invalid API key';
      } else if (status === 429) {
        errorMessage = 'Rate limit exceeded or insufficient quota';
      } else if (data && data.error) {
        errorMessage = `Error: ${data.error.message || data.error.type}`;
      } else {
        errorMessage = `Error ${status}: ${error.message}`;
      }
    } else if (error.message) {
      errorMessage = `Connection failed: ${error.message}`;
    }
    
    res.json({
      success: false,
      error: errorMessage
    });
  }
});

// API endpoint to save settings - Admin only
// Find the /api/save-settings endpoint in your server.js file (around line 1850)
// and replace it with this updated version

app.post('/api/save-settings', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { wordpress, openai, app, recipe, wpRecipeMaker, prompts, rankMath } = req.body;
    
    // Log incoming data for debugging
    console.log('Saving settings with recipe config:', JSON.stringify(recipe, null, 2));
    console.log('WP Recipe Maker config:', JSON.stringify(wpRecipeMaker, null, 2));
    console.log('Prompts config:', JSON.stringify(prompts, null, 2));
    console.log('Rank Math SEO config:', JSON.stringify(rankMath, null, 2));

    // Process boolean values explicitly (checkbox values can come in various formats)
    const recipeEnabled = recipe?.enabled === true || recipe?.enabled === 'true' || recipe?.enabled === 'on';
    const addToAllKeywords = recipe?.addToAllKeywords === true || recipe?.addToAllKeywords === 'true' || recipe?.addToAllKeywords === 'on';
    const useWPRM = recipe?.useWPRM === true || recipe?.useWPRM === 'true' || recipe?.useWPRM === 'on';
    
    const customRecipeFormatEnabled = wpRecipeMaker?.customRecipeFormat?.enabled === true || 
                                      wpRecipeMaker?.customRecipeFormat?.enabled === 'true' || 
                                      wpRecipeMaker?.customRecipeFormat?.enabled === 'on';
    
    const useFixedTemplate = wpRecipeMaker?.customRecipeFormat?.useFixedTemplate === true || 
                             wpRecipeMaker?.customRecipeFormat?.useFixedTemplate === 'true' || 
                             wpRecipeMaker?.customRecipeFormat?.useFixedTemplate === 'on';
    
    const useCustomRecipePrompt = prompts?.useCustomRecipePrompt === true || 
                                  prompts?.useCustomRecipePrompt === 'true' || 
                                  prompts?.useCustomRecipePrompt === 'on';
    
    // Process Rank Math settings explicitly
    const rankMathEnabled = rankMath?.enabled === true || rankMath?.enabled === 'true' || rankMath?.enabled === 'on';
    
    console.log('Processed boolean values:');
    console.log('- Recipe enabled:', recipeEnabled);
    console.log('- Add to all keywords:', addToAllKeywords);
    console.log('- Use WPRM:', useWPRM);
    console.log('- Custom recipe format enabled:', customRecipeFormatEnabled);
    console.log('- Use fixed template:', useFixedTemplate);
    console.log('- Use custom recipe prompt:', useCustomRecipePrompt);
    console.log('- Rank Math enabled:', rankMathEnabled);
    
    // Create updated organization config
    const orgConfig = {
      ...req.orgConfig,
      wordpress: {
        apiUrl: wordpress.apiUrl,
        username: wordpress.username,
        password: wordpress.password
      },
      openai: {
        apiKey: openai.apiKey,
        // Preserve the existing model setting if present, otherwise use incoming value
        model: req.orgConfig.prompts?.model || req.orgConfig.openai.model || 'gpt-4',
        temperature: parseFloat(openai.temperature),
        maxTokens: parseInt(openai.maxTokens),
      },
      app: {
        ...req.orgConfig.app,
        excelFile: req.organization.excelFile, // Keep organization's Excel file
        keywordColumn: app.keywordColumn,
        minWords: parseInt(app.minWords),
        publishStatus: app.publishStatus,
        delayBetweenPosts: parseInt(app.delayBetweenPosts),
        contentTemplate: app.contentTemplate
      },
      // Recipe settings with explicit boolean handling
      recipe: {
        enabled: recipeEnabled,
        apiKey: recipe.apiKey || '',
        keywords: recipe.keywords || 'food,recipe,cooking,dish,meal,breakfast,lunch,dinner,dessert,appetizer,snack',
        useWPRM: useWPRM,
        addToAllKeywords: addToAllKeywords
      },
      // WP Recipe Maker settings with explicit boolean handling
      wpRecipeMaker: {
        enabled: true,
        customRecipeFormat: {
          enabled: customRecipeFormatEnabled,
          useFixedTemplate: useFixedTemplate,
          // Preserve existing custom format settings
          ingredientsFormat: (req.orgConfig.wpRecipeMaker?.customRecipeFormat?.ingredientsFormat || 
                           wpRecipeMaker?.customRecipeFormat?.ingredientsFormat || 
                           "**Ingredients**\n**  **\n{ingredients}"),
          instructionsFormat: (req.orgConfig.wpRecipeMaker?.customRecipeFormat?.instructionsFormat || 
                            wpRecipeMaker?.customRecipeFormat?.instructionsFormat || 
                            "**Instructions**\n** **\n{instructions}"),
          ingredientItemFormat: (req.orgConfig.wpRecipeMaker?.customRecipeFormat?.ingredientItemFormat || 
                               wpRecipeMaker?.customRecipeFormat?.ingredientItemFormat || 
                               "* {ingredient}"),
          instructionItemFormat: (req.orgConfig.wpRecipeMaker?.customRecipeFormat?.instructionItemFormat || 
                               wpRecipeMaker?.customRecipeFormat?.instructionItemFormat || 
                               "Step {number}: {instruction}"),
          useCustomFormatting: true,
          customTemplate: (req.orgConfig.wpRecipeMaker?.customRecipeFormat?.customTemplate || 
                        wpRecipeMaker?.customRecipeFormat?.customTemplate || 
                        "**Ingredients**\n**  **\n* {ingredients}\n\n**Instructions**\n** **\n{instructions}")
        }
      },
      // Prompts settings with explicit boolean handling
      // Preserve existing prompts settings, particularly the model
      prompts: Object.assign({}, req.orgConfig.prompts || {}, prompts || {}, {
        useCustomRecipePrompt: useCustomRecipePrompt,
        recipePromptTemplate: prompts?.recipePromptTemplate || req.orgConfig.prompts?.recipePromptTemplate || '',
        // Ensure we don't overwrite the model setting
        model: req.orgConfig.prompts?.model || req.orgConfig.openai.model || 'gpt-4'
      }),
      // Rank Math settings with explicit boolean handling
      rankMath: {
        enabled: rankMathEnabled,
        titlePrompt: rankMath?.titlePrompt || 'Generate 3 SEO-optimized title options for an article about "{keyword}"...',
        descriptionPrompt: rankMath?.descriptionPrompt || 'Generate 3 SEO meta descriptions for an article about "{keyword}"...',
        permalinkPrompt: rankMath?.permalinkPrompt || 'Generate 3 SEO-friendly URL slugs for an article about "{keyword}"...',
        optionsCount: parseInt(rankMath?.optionsCount || '3')
      }
    };
    
    console.log('Final recipe configuration:', JSON.stringify(orgConfig.recipe, null, 2));
    console.log('Final prompts configuration:', JSON.stringify(orgConfig.prompts, null, 2));
    console.log('Final Rank Math configuration:', JSON.stringify(orgConfig.rankMath, null, 2));
    
    // Save organization-specific config
    const configPath = path.join(__dirname, '../data', req.organization.configFile);
    await fs.writeFile(configPath, JSON.stringify(orgConfig, null, 2));
    
    console.log('Configuration saved successfully to:', configPath);
    
    req.flash('success', 'Settings saved successfully');
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to test prompt generation - Requires authentication
app.post('/api/test-prompt-generation', isAuthenticated, async (req, res) => {
  try {
    const { keyword, promptSettings } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }
    
    // Use a lower word count for testing
    const testWordCount = 200;
    
    // Set up temporary OpenAI config with reduced tokens for faster testing
    const testOpenAIConfig = {
      ...req.orgConfig.openai,
  
    };
    
    // Generate sample content
    const article = await generateArticleContent(
      testOpenAIConfig,
      keyword,
      testWordCount,
      promptSettings
    );
    
    res.json({
      success: true,
      article: {
        title: article.title,
        content: article.content,
        wordCount: article.wordCount
      }
    });
  } catch (error) {
    console.error('Error testing prompt generation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to start the automation - Requires employee privileges
app.post('/api/start-job', isAuthenticated, isEmployee, async (req, res) => {
  if (isJobRunning) {
    return res.status(400).json({ error: 'A job is already running' });
  }
  
  // Validate configuration
  if (!validateConfig()) {
    return res.status(400).json({ error: 'Invalid configuration. Check your .env file.' });
  }
  
  // Start the job
  isJobRunning = true;
  jobProgress = {
    total: 0,
    current: 0,
    currentKeyword: '',
    status: 'Starting...',
    log: [],
    userId: req.session.user.id // Track which user started the job
  };
  
  logProgress('Starting WordPress automation job');
  
  // For employees, only run automation on their own keywords
  let keywordFilter = null;
  if (req.session.user.role === 'employee') {
    keywordFilter = (row) => row.OwnerId === req.session.user.id || row.CreatedBy === req.session.user.id;
  }
  
  // Run the automation in the background
  runAutomation(keywordFilter, req.orgConfig, req.orgExcelFile)
    .then(() => {
      isJobRunning = false;
      jobProgress.status = 'Completed';
      logProgress('Job completed successfully!');
    })
    .catch(error => {
      isJobRunning = false;
      jobProgress.status = 'Failed';
      logProgress(`Job failed: ${error.message}`);
    });
  
  // Return success response
  res.json({ success: true, message: 'Job started successfully' });
});

// Updated API endpoint to process a single keyword - With ownership check
app.post('/api/process-single-keyword', isAuthenticated, isEmployee, async (req, res) => {
  try {
    if (isJobRunning) {
      return res.status(400).json({ error: 'A job is already running' });
    }
    
    const { keyword } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ error: 'Keyword is required' });
    }
    
    // Validate configuration
    if (!validateConfig()) {
      return res.status(400).json({ error: 'Invalid configuration. Check your .env file.' });
    }
    
    // Try to find the keyword in the Excel file
    try {
      const keywordRows = readKeywordsFromExcel(req.orgExcelFile, req.orgConfig.app.keywordColumn);
      const keywordRow = keywordRows.find(row => row[req.orgConfig.app.keywordColumn] === keyword);
      
      if (!keywordRow) {
        return res.status(404).json({ error: 'Keyword not found in Excel file' });
      }
      
      // Check ownership for employees
      if (req.session.user.role === 'employee') {
        if (keywordRow.OwnerId && keywordRow.OwnerId !== req.session.user.id && 
            keywordRow.CreatedBy && keywordRow.CreatedBy !== req.session.user.id) {
          return res.status(403).json({ 
            error: 'You do not have permission to process this keyword' 
          });
        }
      }
      
      // Check if keyword is already published
      if (keywordRow.Status === 'Published') {
        return res.status(400).json({ error: 'This keyword has already been published' });
      }
      
      // Start the job
      isJobRunning = true;
      jobProgress = {
        total: 1,
        current: 0,
        currentKeyword: keyword,
        status: 'Starting...',
        log: [],
        userId: req.session.user.id // Track which user started the job
      };
      
      logProgress(`Starting to process single keyword: "${keyword}"`);
      
      // Process the single keyword (non-blocking)
      processSingleKeyword(keywordRow, req.orgConfig, req.orgExcelFile)
        .then(() => {
          isJobRunning = false;
          jobProgress.status = 'Completed';
          logProgress(`Single keyword processed successfully!`);
        })
        .catch(error => {
          isJobRunning = false;
          jobProgress.status = 'Failed';
          logProgress(`Processing failed: ${error.message}`);
        });
      
      // Return success response
      return res.json({ success: true, message: 'Started processing keyword' });
      
    } catch (error) {
      console.error('Error processing keyword request:', error);
      return res.status(500).json({ error: `Failed to process keyword: ${error.message}` });
    }
  } catch (error) {
    console.error('Unexpected error in process-single-keyword endpoint:', error);
    return res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// API endpoint to get job status - Requires authentication
app.get('/api/job-status', isAuthenticated, (req, res) => {
  // For employees, only return job status for jobs they started
  if (req.session.user.role === 'employee' &&
      jobProgress.userId && 
      jobProgress.userId !== req.session.user.id) {
    // Return empty job status for jobs started by other users
    return res.json({
      isRunning: false,
      progress: {
        total: 0,
        current: 0,
        currentKeyword: '',
        status: 'No job running',
        log: []
      }
    });
  }
  
  // Return full job status for admins or for the user who started the job
  res.json({
    isRunning: isJobRunning,
    progress: jobProgress
  });
});

// Endpoint to add a new keyword - Allow duplicates across different employees
app.post('/api/add-keyword', isAuthenticated, isEmployee, async (req, res) => {
  const { keyword } = req.body;
  
  if (!keyword) {
    return res.status(400).json({ success: false, error: 'Keyword is required' });
  }
  
  try {
    // Load the Excel file
    const workbook = XLSX.readFile(req.orgExcelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Check if keyword already exists FOR THIS USER ONLY
    // This allows different employees to have the same keyword
    const existsForUser = data.some(row => 
      row[req.orgConfig.app.keywordColumn] === keyword && 
      (row.OwnerId === req.session.user.id || row.CreatedBy === req.session.user.id)
    );
    
    if (existsForUser) {
      return res.status(400).json({ 
        success: false, 
        error: 'You already have this keyword in your list' 
      });
    }
    
    // Add the new keyword with ownership information
    const newRow = {
      [req.orgConfig.app.keywordColumn]: keyword,
      Status: 'Pending',
      'Publication Date': '',
      'Post URL': '',
      'Post ID': '',
      // Add ownership information
      OwnerId: req.session.user.id,
      CreatedBy: req.session.user.id,
      CreatedAt: new Date().toISOString() // Add creation timestamp for activity tracking
    };
    
    data.push(newRow);
    
    // Write back to the Excel file
    const newWorksheet = XLSX.utils.json_to_sheet(data);
    workbook.Sheets[sheetName] = newWorksheet;
    XLSX.writeFile(workbook, req.orgExcelFile);
    
    // Log this activity (in a production system, you would use a proper logging system)
    console.log(`User ${req.session.user.username} (${req.session.user.id}) added keyword: ${keyword}`);
    
    res.json({ success: true, message: 'Keyword added successfully' });
  } catch (error) {
    console.error('Error adding keyword:', error);
    res.status(500).json({ success: false, error: `Failed to add keyword: ${error.message}` });
  }
});

// API endpoint to delete a keyword - With ownership check
app.post('/api/delete-keyword', isAuthenticated, isEmployee, async (req, res) => {
  const { keyword } = req.body;
  
  if (!keyword) {
    return res.status(400).json({ success: false, error: 'Keyword is required' });
  }
  
  try {
    // Load the Excel file
    const workbook = XLSX.readFile(req.orgExcelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Find the keyword entry
    const keywordIndex = data.findIndex(row => row[req.orgConfig.app.keywordColumn] === keyword);
    
    if (keywordIndex === -1) {
      return res.status(404).json({ success: false, error: 'Keyword not found' });
    }
    
    // Check ownership if user is an employee (not admin)
    if (req.session.user.role === 'employee') {
      const keywordRow = data[keywordIndex];
      
      // If the keyword doesn't belong to this user, deny access
      if (keywordRow.OwnerId && keywordRow.OwnerId !== req.session.user.id &&
          keywordRow.CreatedBy && keywordRow.CreatedBy !== req.session.user.id) {
        return res.status(403).json({ 
          success: false, 
          error: 'You do not have permission to delete this keyword' 
        });
      }
    }
    
    // Remove the keyword
    data.splice(keywordIndex, 1);
    
    // Write back to the Excel file
    const newWorksheet = XLSX.utils.json_to_sheet(data);
    workbook.Sheets[sheetName] = newWorksheet;
    XLSX.writeFile(workbook, req.orgExcelFile);
    
    res.json({ success: true, message: 'Keyword deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: `Failed to delete keyword: ${error.message}` });
  }
});

// Upload a new Excel file - Requires admin privileges
app.post('/api/upload-excel', isAuthenticated, isAdmin, upload.single('excelFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }
  
  try {
    // Move the uploaded file to the correct location
    await fs.rename(req.file.path, req.orgExcelFile);
    
    // Initialize ownership for all keywords in the file
    try {
      // Get admin user ID
      const users = await getAllUsers();
      const adminUser = users.find(user => user.role === 'admin');
      
      if (adminUser) {
        // Load the Excel file
        const workbook = XLSX.readFile(req.orgExcelFile);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        
        let updated = false;
        
        // Check each row for ownership information
        for (let i = 0; i < data.length; i++) {
          // If no ownership info, add it with admin as default owner
          if (!data[i].OwnerId || !data[i].CreatedBy) {
            data[i].OwnerId = adminUser.id;
            data[i].CreatedBy = adminUser.id;
            updated = true;
          }
        }
        
        // If any rows were updated, write back to the Excel file
        if (updated) {
          const newWorksheet = XLSX.utils.json_to_sheet(data);
          workbook.Sheets[sheetName] = newWorksheet;
          XLSX.writeFile(workbook, req.orgExcelFile);
          console.log('Initialized ownership information for all keywords in the uploaded file');
        }
      }
    } catch (initError) {
      console.warn('Error initializing ownership for uploaded file:', initError);
      // Continue without failing - file was still uploaded
    }
    
    res.json({ success: true, message: 'Excel file uploaded successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: `Failed to upload file: ${error.message}` });
  }
});

// API endpoint to get keyword statistics for the dashboard - Requires authentication
app.get('/api/keyword-stats', isAuthenticated, async (req, res) => {
  try {
    // Check if Excel file exists
    const excelFileExists = await fileExists(req.orgExcelFile);
    
    if (!excelFileExists) {
      return res.json({
        total: 0,
        published: 0,
        pending: 0
      });
    }
    
    // Load the Excel file
    const workbook = XLSX.readFile(req.orgExcelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // For employees, filter to only their keywords
    let filteredData = data;
    if (req.session.user.role === 'employee') {
      filteredData = data.filter(row => 
        row.OwnerId === req.session.user.id || row.CreatedBy === req.session.user.id
      );
    }
    
    // Calculate stats
    const total = filteredData.length;
    const published = filteredData.filter(row => row.Status === 'Published').length;
    const pending = filteredData.filter(row => row.Status === 'Pending' || row.Status === undefined || row.Status === '').length;
    
    // Return stats as JSON
    res.json({
      total,
      published,
      pending
    });
  } catch (error) {
    console.error('Error getting keyword stats:', error);
    res.status(500).json({
      error: `Failed to get keyword stats: ${error.message}`,
      total: 0,
      published: 0,
      pending: 0
    });
  }
});

// Updated API endpoint to generate content - With better error handling
// API endpoint to generate content - With better error handling
app.post('/api/generate-content', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const { keyword } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }
    
    console.log(`Generating content for keyword: "${keyword}" by user ${req.session.user.username}`);
    
    // ... [keep the existing code here] ...
    
    // Generate article
    // Generate article
console.log(`Starting content generation for "${keyword}"`);
const article = await generateArticleContent(
  req.orgConfig.openai, 
  keyword, 
  req.orgConfig.app.minWords,
  req.orgConfig.prompts || req.orgConfig.app.contentTemplate || ''
);
    console.log(`Successfully generated content for "${keyword}"`);
    
    // Cache the article
    if (!req.app.locals.cachedArticles) {
      req.app.locals.cachedArticles = {};
    }
    req.app.locals.cachedArticles[keyword] = article;
    
    // Add diagnostic logging
    console.log('Rank Math Integration Status:');
    console.log('- rankMath config:', JSON.stringify(req.orgConfig.rankMath || '(not defined)'));
    console.log('- Is Rank Math enabled:', !!(req.orgConfig.rankMath && req.orgConfig.rankMath.enabled));
    console.log('- Redirect path:', req.orgConfig.rankMath && req.orgConfig.rankMath.enabled 
      ? `/generate-seo/${encodeURIComponent(keyword)}/${article.id || 'temp'}` 
      : `/preview/${encodeURIComponent(keyword)}`);
    
    // Add an ID to the article if it doesn't have one
    if (!article.id) {
      article.id = 'temp_' + Date.now();
      console.log(`Added temporary ID to article: ${article.id}`);
    }
    
    // Return success with articleId and check for Rank Math SEO integration
    return res.json({
      success: true,
      article,
      redirect: req.orgConfig.rankMath && req.orgConfig.rankMath.enabled 
        ? `/generate-seo/${encodeURIComponent(keyword)}/${article.id || 'temp'}` 
        : `/preview/${encodeURIComponent(keyword)}`
    });
  } catch (error) {
    console.error(`Error generating content for "${req.body.keyword}":`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Updated API endpoint to regenerate content - With ownership check
app.post('/api/regenerate-content', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const { keyword } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }
    
    // Check ownership for employees
    if (req.session.user.role === 'employee') {
      // Load the Excel file to check ownership
      const workbook = XLSX.readFile(req.orgExcelFile);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      // Find the keyword
      const keywordRow = data.find(row => row[req.orgConfig.app.keywordColumn] === keyword);
      
      if (keywordRow) {
        // Check if the user owns this keyword
        if (keywordRow.OwnerId && keywordRow.OwnerId !== req.session.user.id &&
            keywordRow.CreatedBy && keywordRow.CreatedBy !== req.session.user.id) {
          return res.status(403).json({
            success: false,
            error: 'You do not have permission to regenerate content for this keyword'
          });
        }
      }
    }
    
    // Check if we should use prompts settings
    let promptSettings = null;
    
    if (req.orgConfig.prompts) {
      promptSettings = {
        useMultiPartGeneration: req.orgConfig.prompts.useMultiPartGeneration,
        mainPrompt: req.orgConfig.prompts.mainPrompt || req.orgConfig.app.contentTemplate,
        part1Prompt: req.orgConfig.prompts.part1Prompt,
        part2Prompt: req.orgConfig.prompts.part2Prompt,
        part3Prompt: req.orgConfig.prompts.part3Prompt,
        toneVoice: req.orgConfig.prompts.toneVoice,
        seoGuidelines: req.orgConfig.prompts.seoGuidelines,
        thingsToAvoid: req.orgConfig.prompts.thingsToAvoid
      };
    } else if (req.orgConfig.app.contentTemplate) {
      // Fallback to just using content template
      promptSettings = req.orgConfig.app.contentTemplate;
    }
    
    // Generate article
    const article = await generateArticleContent(
      req.orgConfig.openai, 
      keyword, 
      req.orgConfig.app.minWords,
      promptSettings
    );
    
    // Cache the article
    if (!req.app.locals.cachedArticles) {
      req.app.locals.cachedArticles = {};
    }
    req.app.locals.cachedArticles[keyword] = article;
    
    // Return success with the article data
    res.json({
      success: true,
      article
    });
  } catch (error) {
    console.error('Error regenerating content:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update the /api/publish-content endpoint in server.js
app.post('/api/publish-content', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const { keyword, title, content, status } = req.body;
    
    if (!keyword || !title || !content) {
      return res.status(400).json({ success: false, error: 'Keyword, title, and content are required' });
    }
    
    // Add recipe debugging
    console.log('Recipe configuration in request:', req.orgConfig.recipe);
    
    // Check if the keyword exists in Excel
    const keywordRows = readKeywordsFromExcel(req.orgExcelFile, req.orgConfig.app.keywordColumn);
    const keywordRow = keywordRows.find(row => row[req.orgConfig.app.keywordColumn] === keyword);
    
    if (!keywordRow) {
      return res.status(404).json({ success: false, error: 'Keyword not found in Excel file' });
    }
    
    // Check ownership for employees
    if (req.session.user.role === 'employee') {
      if (keywordRow.OwnerId && keywordRow.OwnerId !== req.session.user.id &&
          keywordRow.CreatedBy && keywordRow.CreatedBy !== req.session.user.id) {
        return res.status(403).json({
          success: false,
          error: 'You do not have permission to publish content for this keyword'
        });
      }
    }
    
    // Create article object with validated content
    const article = {
      title: String(title),
      content: String(content),
      wordCount: String(content).split(/\s+/).filter(word => word.length > 0).length
    };
    
    // Get SEO metadata from session if available
    let seoMetadata = null;
    if (req.session.selectedSeoOption) {
      seoMetadata = req.session.selectedSeoOption;
      console.log('Using SEO metadata from session:', seoMetadata);
    }
    
    console.log(`Publishing article: "${article.title}" for keyword "${keyword}"`);
    console.log(`Content length: ${article.content.length} characters`);
    
    try {
      // Check if recipe integration is needed
      const recipeEnabled = req.orgConfig.recipe && req.orgConfig.recipe.enabled;
      const recipeHelper = require('../src/recipe-helper');
      console.log('Recipe Integration Debug:');
      console.log('- Recipe config:', JSON.stringify(req.orgConfig.recipe, null, 2));
      console.log('- Recipe enabled:', !!recipeEnabled);
      console.log('- Keyword:', keyword);
      console.log('- Recipe keywords:', req.orgConfig.recipe?.keywords);
      console.log('- Add to all keywords:', !!req.orgConfig.recipe?.addToAllKeywords);
      console.log('- Use WPRM:', !!req.orgConfig.recipe?.useWPRM);

      // First try the normal approach
      let shouldAddRecipe = false;
      if (recipeEnabled) {
        shouldAddRecipe = recipeHelper.shouldAddRecipe(keyword, req.orgConfig.recipe);
        console.log('Natural shouldAddRecipe result:', shouldAddRecipe);

        // If the normal approach fails but addToAllKeywords is true, we'll force it
        if (!shouldAddRecipe && req.orgConfig.recipe.addToAllKeywords) {
          shouldAddRecipe = true;
          console.log('Forcing recipe addition due to addToAllKeywords setting');
        }
      }
      console.log(`Recipe integration check - Enabled: ${recipeEnabled}, Should add: ${shouldAddRecipe}`);
      
      let publishData;
      
      if (shouldAddRecipe) {
        console.log(`Using recipe integration path for "${keyword}"`);
        
        try {
          // First publish the article normally
          const { publishToWordPress } = require('../src/wordpress');
          publishData = await publishToWordPress(
            req.orgConfig.wordpress,
            article,
            keyword,
            status || 'draft',
            seoMetadata // Pass SEO metadata to publishToWordPress
          );
          
          // Then add the recipe to it
          const { OpenAI } = require('openai');
          const openai = new OpenAI({
            apiKey: req.orgConfig.openai.apiKey,
          });
          
          // Generate recipe data
          console.log(`Generating recipe data for "${keyword}"...`);
          const recipeData = await recipeHelper.generateRecipeData(
            openai,
            req.orgConfig.openai,
            keyword
          );
          
          if (recipeData) {
            console.log(`Recipe data generated, adding to post ID: ${publishData.postId}`);
            
            // Add recipe to post
            const recipeResult = await recipeHelper.addRecipeToPost(
              req.orgConfig.wordpress,
              req.orgConfig.recipe,
              recipeData,
              publishData.postId
            );
            
            if (recipeResult && recipeResult.success) {
              console.log('Recipe added successfully!');
              publishData.recipeAdded = true;
            } else {
              console.log('Recipe addition failed:', recipeResult?.error || 'Unknown error');
              publishData.recipeAdded = false;
            }
          } else {
            console.log('Failed to generate recipe data');
            publishData.recipeAdded = false;
          }
        } catch (err) {
          console.error('Error in recipe integration flow:', err);
          // Fallback to standard publishing if recipe integration fails
          const { publishToWordPress } = require('../src/wordpress');
          publishData = await publishToWordPress(
            req.orgConfig.wordpress,
            article,
            keyword,
            status || 'draft',
            seoMetadata // Pass SEO metadata to publishToWordPress
          );
        }
      } else {
        // No recipe integration needed, use standard publishing
        console.log(`Using standard publishing for "${keyword}"`);
        
        // Import function directly to avoid reference errors
        const { publishToWordPress } = require('../src/wordpress');
        
        // Publish to WordPress with SEO metadata
        publishData = await publishToWordPress(
          req.orgConfig.wordpress,
          article,
          keyword,
          status || 'draft',
          seoMetadata // Pass SEO metadata to publishToWordPress
        );
      }
      
      // Apply SEO metadata again if available (double-check approach)
      if (publishData && publishData.postId && seoMetadata) {
        try {
          console.log(`Applying SEO metadata to newly published post ID: ${publishData.postId}`);
          const rankMathModule = require('../src/rank-math');
          await rankMathModule.applySeoMetadataToPost(
            req.orgConfig.wordpress,
            seoMetadata,
            publishData.postId  // This is the actual post ID from WordPress
          );
          console.log('✓ SEO metadata applied successfully to published post');
          
          // Clean up session
          delete req.session.selectedSeoOption;
          delete req.session.seoOptions;
        } catch (seoError) {
          console.error('Error applying SEO metadata:', seoError);
          // Continue with publishing even if SEO metadata fails
        }
      }
      
      // Update Excel with publication status
      updateExcelWithPublicationStatus(req.orgExcelFile, keywordRow, publishData);
      
      // Remove from cache
      if (req.app.locals.cachedArticles && req.app.locals.cachedArticles[keyword]) {
        delete req.app.locals.cachedArticles[keyword];
      }
      
      // Return success with recipe info if available
      return res.json({
        success: true,
        publishData,
        recipeAdded: publishData.recipeAdded || false,
        message: `Article ${status === 'publish' ? 'published' : 'saved as draft'} successfully ${publishData.recipeAdded ? '(with recipe)' : ''}`
      });
    } catch (publishError) {
      console.error('Error in publishing process:', publishError);
      return res.status(500).json({ 
        success: false, 
        error: `Failed to save article: ${publishError.message}` 
      });
    }
  } catch (error) {
    console.error('Error publishing content:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Updates needed for web/server.js
// Add these changes to the existing server.js

// Add these routes to your server.js file, in the routes section

// Route to generate SEO metadata
app.get('/generate-seo/:keyword/:articleId', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const keyword = req.params.keyword;
    const articleId = req.params.articleId;
    
    console.log(`Rendering SEO generation page for keyword: "${keyword}", article ID: ${articleId}`);
    
    // Render the SEO generation page
    res.render('seo-generate', {
      page: 'seo-generate',
      keyword: keyword,
      articleId: articleId,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (error) {
    console.error('Error rendering SEO generation page:', error);
    req.flash('error', 'Error rendering SEO generation page: ' + error.message);
    res.redirect('/keywords');
  }
});

// Route to select SEO metadata
app.get('/select-seo/:keyword/:articleId', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const keyword = req.params.keyword;
    const articleId = req.params.articleId;
    
    console.log(`Rendering SEO selection page for keyword: "${keyword}", article ID: ${articleId}`);
    
    // Get SEO options from session
    const seoOptions = req.session.seoOptions || [];
    
    if (seoOptions.length === 0) {
      // If no options in session, redirect to generation page
      return res.redirect(`/generate-seo/${encodeURIComponent(keyword)}/${articleId}`);
    }
    
    // Render the SEO selection page
    res.render('seo-select', {
      page: 'seo-select',
      keyword: keyword,
      articleId: articleId,
      seoOptions: seoOptions,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (error) {
    console.error('Error rendering SEO selection page:', error);
    req.flash('error', 'Error rendering SEO selection page: ' + error.message);
    res.redirect('/keywords');
  }
});

// API endpoint to generate SEO metadata
app.post('/api/generate-seo-metadata', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const { keyword, articleId } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }
    
    console.log(`Generating SEO metadata for keyword: "${keyword}", article ID: ${articleId}`);
    
    // Check if Rank Math integration is enabled
    if (!req.orgConfig.rankMath || !req.orgConfig.rankMath.enabled) {
      return res.status(400).json({ 
        success: false, 
        error: 'Rank Math integration is not enabled in settings' 
      });
    }
    
    // Get article info for context (optional)
    let articleTitle = '';
    let articleExcerpt = '';
    
    // If articleId is provided, try to get the article content from cache or WordPress
    if (articleId && req.app.locals.cachedArticles && req.app.locals.cachedArticles[keyword]) {
      articleTitle = req.app.locals.cachedArticles[keyword].title || '';
      
      // Create a simple excerpt from the content
      const content = req.app.locals.cachedArticles[keyword].content || '';
      articleExcerpt = content.replace(/<[^>]*>/g, '').substring(0, 200) + '...';
    }
    
    // Import the Rank Math module
    const rankMathModule = require('../src/rank-math');
    
    // Generate SEO metadata options
    const seoOptions = await rankMathModule.generateSeoMetadataOptions(
      req.orgConfig.openai,
      req.orgConfig.rankMath,
      keyword,
      articleTitle,
      articleExcerpt
    );
    
    // Store options in session for the selection page
    req.session.seoOptions = seoOptions.map(option => ({
      ...option,
      keyword: keyword // Add keyword to each option
    }));
    
    // Return success response
    res.json({
      success: true,
      redirect: `/select-seo/${encodeURIComponent(keyword)}/${articleId}`
    });
  } catch (error) {
    console.error('Error generating SEO metadata:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to regenerate SEO metadata
app.post('/api/regenerate-seo-metadata', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const { keyword, articleId } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }
    
    console.log(`Regenerating SEO metadata for keyword: "${keyword}", article ID: ${articleId}`);
    
    // Check if Rank Math integration is enabled
    if (!req.orgConfig.rankMath || !req.orgConfig.rankMath.enabled) {
      return res.status(400).json({ 
        success: false, 
        error: 'Rank Math integration is not enabled in settings' 
      });
    }
    
    // Get article info for context (optional)
    let articleTitle = '';
    let articleExcerpt = '';
    
    // If articleId is provided, try to get the article content from cache or WordPress
    if (articleId && req.app.locals.cachedArticles && req.app.locals.cachedArticles[keyword]) {
      articleTitle = req.app.locals.cachedArticles[keyword].title || '';
      
      // Create a simple excerpt from the content
      const content = req.app.locals.cachedArticles[keyword].content || '';
      articleExcerpt = content.replace(/<[^>]*>/g, '').substring(0, 200) + '...';
    }
    
    // Import the Rank Math module
    const rankMathModule = require('../src/rank-math');
    
    // Generate SEO metadata options
    const seoOptions = await rankMathModule.generateSeoMetadataOptions(
      req.orgConfig.openai,
      req.orgConfig.rankMath,
      keyword,
      articleTitle,
      articleExcerpt
    );
    
    // Store options in session for the selection page
    req.session.seoOptions = seoOptions.map(option => ({
      ...option,
      keyword: keyword // Add keyword to each option
    }));
    
    // Return success response
    res.json({
      success: true,
      message: 'SEO metadata regenerated successfully'
    });
  } catch (error) {
    console.error('Error regenerating SEO metadata:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to save selected SEO option
// Update this endpoint in server.js
app.post('/api/save-seo-selection', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const { keyword, articleId, selectedOptionIndex } = req.body;
    
    if (!keyword || selectedOptionIndex === undefined) {
      return res.status(400).json({ success: false, error: 'Keyword and selected option are required' });
    }
    
    console.log(`Saving selected SEO option ${selectedOptionIndex} for keyword: "${keyword}", article ID: ${articleId}`);
    
    // Get SEO options from session
    const seoOptions = req.session.seoOptions || [];
    
    if (seoOptions.length === 0 || !seoOptions[selectedOptionIndex]) {
      return res.status(400).json({ 
        success: false, 
        error: 'Selected SEO option not found' 
      });
    }
    
    // Get the selected SEO option and ensure keyword is included
    const selectedOption = seoOptions[selectedOptionIndex];
    
    // Store the selected option in session (can be used later when publishing)
    req.session.selectedSeoOption = {
      ...selectedOption,
      keyword: keyword
    };
    // Sync the article title with the selected SEO title
if (req.app.locals.cachedArticles && req.app.locals.cachedArticles[keyword]) {
  console.log(`Updating cached article title for "${keyword}" to match SEO title: "${selectedOption.title}"`);
  req.app.locals.cachedArticles[keyword].title = selectedOption.title;
}
    
    // Check if articleId is a temporary ID (starts with 'temp_')
    const isTemporary = typeof articleId === 'string' && articleId.startsWith('temp_');
    
    // If articleId is provided and is not temporary, apply the SEO metadata to the post now
    if (articleId && !isTemporary) {
      try {
        // Import the Rank Math module
        const rankMathModule = require('../src/rank-math');
        
        // Apply SEO metadata to the post
        await rankMathModule.applySeoMetadataToPost(
          req.orgConfig.wordpress,
          {
            ...selectedOption,
            keyword: keyword
          },
          articleId
        );
        
        console.log(`✓ SEO metadata applied to post ID: ${articleId}`);
      } catch (seoError) {
        console.error('Error applying SEO metadata to existing post:', seoError);
        // Continue with the flow even if there's an error applying metadata
        // The metadata is already stored in the session for later use
      }
    } else if (isTemporary) {
      console.log('Article ID is temporary. SEO metadata will be applied during publishing.');
    }
    
    // Return success response
    res.json({
      success: true,
      redirect: `/preview/${encodeURIComponent(keyword)}`
    });
  } catch (error) {
    console.error('Error saving SEO selection:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Update the middleware section (after session middleware)
app.use(attachOrganizationToRequest);

// 3. Add registration routes (before authentication routes)
app.use('/', registrationRoutes);

// API endpoint to test Rank Math connection
app.post('/api/test-rank-math', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { apiUrl, username, password } = req.body;
    
    if (!apiUrl || !username || !password) {
      return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }
    
    // Test connection to Rank Math
    const rankMathModule = require('../src/rank-math');
    const isConnected = await rankMathModule.testRankMathConnection({
      apiUrl,
      username,
      password
    });
    
    if (isConnected) {
      res.json({
        success: true,
        message: 'Rank Math connection successful'
      });
    } else {
      res.json({
        success: false,
        error: 'Rank Math connection failed. Please check if the Rank Math plugin is installed and properly configured.'
      });
    }
  } catch (error) {
    res.json({
      success: false,
      error: 'Connection failed: ' + error.message
    });
  }
});

// Add this to your app.js or server.js or in your routes directory
// Additional routes for prompt settings

// Save prompt settings
// API endpoint to save prompt settings
// API endpoint to save prompt settings with model validation
// API endpoint to save prompt settings with model validation
// API endpoint to save prompt settings with model validation
// In server.js, update the /api/save-prompt-settings endpoint
app.post('/api/save-prompt-settings', isAuthenticated, async (req, res) => {
  try {
    // Get all the setting values from the request
    const {
      // Existing settings
      useMultiPartGeneration, systemPrompt, userPrompt, model, temperature, maxTokens,
      mainPrompt, part1Prompt, part2Prompt, part3Prompt,
      // SEO settings
      seoSystemPrompt, seoTitlePrompt, seoDescriptionPrompt, seoPermalinkPrompt,
      seoModelTemperature, seoModelName
    } = req.body;
    
    // Create updated config
    const orgConfig = {
      ...req.orgConfig,
      prompts: {
        ...req.orgConfig.prompts,
        // Existing settings
        useMultiPartGeneration: useMultiPartGeneration === true,
        systemPrompt: systemPrompt || '',
        userPrompt: userPrompt || '',
        model: model || 'gpt-4',
        temperature: parseFloat(temperature) || 0.7,
        maxTokens: parseInt(maxTokens || '4000'),
        mainPrompt: mainPrompt || '',
        part1Prompt: part1Prompt || '',
        part2Prompt: part2Prompt || '',
        part3Prompt: part3Prompt || '',
      },
      // Update Rank Math settings to include new fields
      rankMath: {
        ...req.orgConfig.rankMath,
        systemPrompt: seoSystemPrompt || '',
        titlePrompt: seoTitlePrompt || '',
        descriptionPrompt: seoDescriptionPrompt || '',
        permalinkPrompt: seoPermalinkPrompt || '',
        temperature: parseFloat(seoModelTemperature) || 0.7,
        model: seoModelName || 'gpt-4',
        enabled: req.orgConfig.rankMath ? req.orgConfig.rankMath.enabled : false,
        optionsCount: req.orgConfig.rankMath ? req.orgConfig.rankMath.optionsCount : 3
      }
    };
    
    // Save the updated config
    const configPath = path.join(__dirname, '../data', req.organization.configFile);
    await fs.writeFile(configPath, JSON.stringify(orgConfig, null, 2));
    
    req.flash('success', 'Prompt settings saved successfully');
    res.json({ success: true, message: 'Prompt settings saved successfully' });
  } catch (error) {
    console.error('Error saving prompt settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test prompt generation - fixed to use organization config
// Test prompt generation - fixed to use organization config
// Test prompt generation that focuses on using system and user prompts
app.post('/api/test-prompt-generation', isAuthenticated, async (req, res) => {
  try {
    const { keyword, promptSettings } = req.body;
    
    // Validate inputs
    if (!keyword) {
      return res.status(400).json({
        success: false,
        error: 'Keyword is required'
      });
    }
    
    // Check if OpenAI is configured
    if (!req.orgConfig.openai || !req.orgConfig.openai.apiKey) {
      return res.status(400).json({
        success: false,
        error: 'OpenAI API is not configured properly'
      });
    }
    
    // Log important values for debugging
    console.log('Test generation for keyword:', keyword);
    console.log('System prompt length:', promptSettings.systemPrompt?.length || 0);
    console.log('User prompt length:', promptSettings.userPrompt?.length || 0);
    console.log('Model:', promptSettings.model || req.orgConfig.openai.model || 'gpt-4');
    
    // Setup test OpenAI config
    const openaiConfig = {
      apiKey: req.orgConfig.openai.apiKey,
      model: promptSettings.model || req.orgConfig.openai.model || 'gpt-4',
      temperature: parseFloat(promptSettings.temperature) || req.orgConfig.openai.temperature || 0.7
    };
    
    // Create focused prompt settings object (system and user prompts)
    const focusedPromptSettings = {
      systemPrompt: promptSettings.systemPrompt || '',
      userPrompt: promptSettings.userPrompt || '',
      // Always set this to false since we're only using system/user prompts
      useMultiPartGeneration: false,
      // Empty values for other fields
      mainPrompt: '',
      part1Prompt: '',
      part2Prompt: '',
      part3Prompt: '',
      toneVoice: '',
      seoGuidelines: '',
      thingsToAvoid: '',
      articleFormat: '',
      useArticleFormat: false
    };
    
    // Generate a test article (shorter version)
    const article = await generateArticleContent(
      openaiConfig,
      keyword,
      300, // Use a smaller word count for testing
      focusedPromptSettings
    );
    
    // Return the result
    res.json({
      success: true,
      article: {
        title: article.title,
        content: article.content.substring(0, 1000) + '...' // Trim for response size
      }
    });
  } catch (error) {
    console.error('Error testing prompt generation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
