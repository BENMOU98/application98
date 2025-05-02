// src/excel.js
//
// This module handles Excel file operations:
// - Reading keywords from Excel file
// - Updating Excel with publication status

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

/**
 * Read keywords from Excel file
 * @param {string} filePath - Path to the Excel file
 * @param {string} keywordColumn - Column name containing keywords
 * @returns {Object[]} Array of row objects with keywords and metadata
 */
function readKeywordsFromExcel(filePath, keywordColumn) {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`Excel file not found at: ${filePath}`);
      console.log(`Current working directory: ${process.cwd()}`);
      throw new Error(`File not found: ${filePath}`);
    }
    
    // Load the Excel file
    const workbook = XLSX.readFile(filePath);
    
    // Get the first sheet
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Debug: Show what columns are available
    if (data.length > 0) {
      console.log('Available columns:', Object.keys(data[0]));
    } else {
      console.log('The Excel file appears to be empty or improperly formatted');
      return [];
    }
    
    // Filter rows that have a valid keyword and status is not "Published"
    const pendingKeywords = data.filter(row => 
      row[keywordColumn] && 
      (!row.Status || row.Status.toLowerCase() !== 'published')
    );
    
    console.log(`Read ${pendingKeywords.length} pending keywords from Excel file`);
    return pendingKeywords;
  } catch (error) {
    console.error('Error reading Excel file:', error.message);
    throw error;
  }
}

/**
 * Update Excel file with publication status
 * @param {string} excelFile - Path to Excel file
 * @param {Object} keywordRow - Row from Excel file containing the keyword
 * @param {Object} publishData - Data from WordPress publication
 */
function updateExcelWithPublicationStatus(excelFile, keywordRow, publishData) {
  try {
    console.log('Updating Excel with publication status');
    
    // Verify the file path is a string
    if (typeof excelFile !== 'string') {
      throw new Error('Excel file path must be a string');
    }
    
    // Ensure the file path is absolute
    const absoluteExcelPath = path.isAbsolute(excelFile) ? 
      excelFile : path.resolve(process.cwd(), excelFile);
    
    console.log(`Reading Excel file from: ${absoluteExcelPath}`);
    
    // Check if file exists
    if (!fs.existsSync(absoluteExcelPath)) {
      throw new Error(`Excel file not found: ${absoluteExcelPath}`);
    }
    
    // Load the Excel file
    const workbook = XLSX.readFile(absoluteExcelPath);
    
    // Get the first sheet
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Find the index of the keyword in the data
    const keywordColumn = Object.keys(keywordRow)[0]; // Get the first key (usually the keyword column)
    const keywordValue = keywordRow[keywordColumn];
    
    console.log(`Looking for keyword: ${keywordValue} in column: ${keywordColumn}`);
    
    const rowIndex = data.findIndex(row => row[keywordColumn] === keywordValue);
    
    if (rowIndex === -1) {
      console.error(`Keyword "${keywordValue}" not found in Excel file`);
      return;
    }
    
    console.log(`Found keyword at row index: ${rowIndex}`);
    
    // Format the current date
    const now = new Date();
    const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    // Update the row with the publication status
    data[rowIndex].Status = 'Published';
    data[rowIndex]['Publication Date'] = formattedDate;
    data[rowIndex]['Post URL'] = publishData.postUrl || '';
    
    // Add Post ID if available (important for previewing content later)
    if (publishData.postId) {
      data[rowIndex]['Post ID'] = publishData.postId;
    }
    
    console.log('Converting updated data to worksheet');
    
    // Create a new worksheet from the updated data
    const newWorksheet = XLSX.utils.json_to_sheet(data);
    
    // Update the workbook with the new worksheet
    workbook.Sheets[sheetName] = newWorksheet;
    
    // Write directly to the file - no temporary file
    console.log(`Writing directly to file: ${absoluteExcelPath}`);
    
    // Explicitly specify the bookType as 'xlsx'
    XLSX.writeFile(workbook, absoluteExcelPath, { bookType: 'xlsx' });
    
    console.log(`Successfully updated Excel file for keyword "${keywordValue}"`);
  } catch (error) {
    console.error('Error updating Excel with publication status:', error);
    throw new Error(`Error updating Excel with publication status: ${error.message}`);
  }
}

/**
 * Add keywords to Excel file
 * @param {string} excelFile - Path to Excel file
 * @param {string[]} keywords - Array of keywords to add
 * @param {string} keywordColumn - Name of the keyword column
 */
function addKeywordsToExcel(excelFile, keywords, keywordColumn) {
  try {
    // Load the Excel file if it exists, otherwise create a new one
    let workbook;
    let data = [];
    
    if (fs.existsSync(excelFile)) {
      workbook = XLSX.readFile(excelFile);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(worksheet);
    } else {
      workbook = XLSX.utils.book_new();
    }
    
    // Process each keyword
    for (const keyword of keywords) {
      // Check if keyword already exists
      const exists = data.some(row => row[keywordColumn] === keyword);
      
      if (!exists) {
        // Add new row
        const newRow = {
          [keywordColumn]: keyword,
          Status: 'Pending',
          'Publication Date': '',
          'Post URL': '',
          'Post ID': ''
        };
        
        data.push(newRow);
      }
    }
    
    // Write updated data back to the Excel file
    const newWorksheet = XLSX.utils.json_to_sheet(data);
    
    // Add or update the sheet
    if (workbook.SheetNames.length === 0) {
      XLSX.utils.book_append_sheet(workbook, newWorksheet, 'Keywords');
    } else {
      workbook.Sheets[workbook.SheetNames[0]] = newWorksheet;
    }
    
    // Write to file with explicit bookType
    XLSX.writeFile(workbook, excelFile, { bookType: 'xlsx' });
    
    console.log(`Added ${keywords.length} keywords to Excel file`);
    
    return data.length;
  } catch (error) {
    console.error('Error adding keywords to Excel:', error);
    throw error;
  }
}

/**
 * Create a sample Excel file with keywords
 * @param {string} excelFile - Path to Excel file
 */
function createSampleExcelFile(excelFile) {
  // Check if file already exists
  if (fs.existsSync(excelFile)) {
    return;
  }
  
  console.log(`Creating sample Excel file at ${excelFile}`);
  
  // Create a workbook with a worksheet
  const workbook = XLSX.utils.book_new();
  
  // Define the columns we need
  const data = [
    {
      Keyword: 'sample-keyword-1',
      Status: 'Pending',
      'Publication Date': '',
      'Post URL': '',
      'Post ID': ''
    },
    {
      Keyword: 'sample-keyword-2',
      Status: 'Pending',
      'Publication Date': '',
      'Post URL': '',
      'Post ID': ''
    }
  ];
  
  // Create a worksheet from the data
  const worksheet = XLSX.utils.json_to_sheet(data);
  
  // Add the worksheet to the workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Keywords');
  
  // Write the workbook to file with explicit bookType
  XLSX.writeFile(workbook, excelFile, { bookType: 'xlsx' });
  
  console.log('Sample Excel file created with example keywords');
}

module.exports = {
  readKeywordsFromExcel,
  updateExcelWithPublicationStatus,
  addKeywordsToExcel,
  createSampleExcelFile
};