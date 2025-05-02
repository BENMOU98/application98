// initialize-ownership.js
//
// This script initializes ownership information in the Excel file
// It should be run once when upgrading the system to add ownership tracking

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const fs = require('fs').promises;

// Get configuration
const { config } = require('./src/config');

// Get admin user ID from users.json
async function getAdminUserId() {
  try {
    const usersFilePath = path.join(__dirname, 'data/users.json');
    const data = await fs.readFile(usersFilePath, 'utf8');
    const users = JSON.parse(data).users;
    
    // Find admin user
    const adminUser = users.find(user => user.role === 'admin');
    
    if (!adminUser) {
      throw new Error('Admin user not found in users.json');
    }
    
    return adminUser.id;
  } catch (error) {
    console.error('Error getting admin user ID:', error);
    throw error;
  }
}

// Initialize ownership for existing keywords
async function initializeKeywordOwnership(excelFile, keywordColumn, adminUserId) {
  try {
    console.log(`Initializing ownership for keywords in ${excelFile}`);
    
    // Check if Excel file exists
    try {
      await fs.access(excelFile);
    } catch (error) {
      console.error(`Excel file not found at: ${excelFile}`);
      return false;
    }
    
    // Read the Excel file
    const workbook = XLSX.readFile(excelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`Found ${data.length} keywords in Excel file`);
    
    let updated = false;
    
    // Check each row for ownership information
    for (let i = 0; i < data.length; i++) {
      // If no ownership info, add it with admin as default owner
      if (!data[i].OwnerId || !data[i].CreatedBy) {
        data[i].OwnerId = adminUserId;
        data[i].CreatedBy = adminUserId;
        updated = true;
        console.log(`Added ownership to keyword: ${data[i][keywordColumn]}`);
      }
    }
    
    // If any rows were updated, write back to the Excel file
    if (updated) {
      const newWorksheet = XLSX.utils.json_to_sheet(data);
      workbook.Sheets[sheetName] = newWorksheet;
      XLSX.writeFile(workbook, excelFile);
      console.log('Initialized ownership information for existing keywords');
    } else {
      console.log('All keywords already have ownership information');
    }
    
    return updated;
  } catch (error) {
    console.error('Error initializing keyword ownership:', error);
    return false;
  }
}

// Main function
async function main() {
  try {
    // Get admin user ID
    const adminUserId = await getAdminUserId();
    console.log(`Using admin user ID: ${adminUserId}`);
    
    // Initialize ownership for existing keywords
    await initializeKeywordOwnership(
      config.app.excelFile,
      config.app.keywordColumn,
      adminUserId
    );
    
    console.log('Ownership initialization complete');
  } catch (error) {
    console.error('Initialization failed:', error);
    process.exit(1);
  }
}

// Run the main function
main();