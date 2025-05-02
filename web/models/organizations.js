// web/models/organizations.js
// Organization model for multi-tenant support

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// File to store organization data
const ORGANIZATIONS_FILE = path.join(__dirname, '../../data/organizations.json');

// Create data directory and organizations file if they don't exist
async function ensureOrganizationsFileExists() {
  try {
    const dataDir = path.join(__dirname, '../../data');
    
    // Create data directory if it doesn't exist
    try {
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    
    // Check if organizations file exists
    try {
      await fs.access(ORGANIZATIONS_FILE);
    } catch (error) {
      // Create the file with empty organizations array
      await fs.writeFile(ORGANIZATIONS_FILE, JSON.stringify({ organizations: [] }, null, 2));
      console.log('Created organizations file');
    }
  } catch (error) {
    console.error('Error ensuring organizations file exists:', error);
    throw error;
  }
}

// Load all organizations
async function getAllOrganizations() {
  await ensureOrganizationsFileExists();
  
  try {
    const data = await fs.readFile(ORGANIZATIONS_FILE, 'utf8');
    return JSON.parse(data).organizations;
  } catch (error) {
    console.error('Error loading organizations:', error);
    return [];
  }
}

// Save all organizations
async function saveOrganizations(organizations) {
  try {
    await fs.writeFile(ORGANIZATIONS_FILE, JSON.stringify({ organizations }, null, 2));
  } catch (error) {
    console.error('Error saving organizations:', error);
    throw error;
  }
}

// Generate organization ID
function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

// Create organization
async function createOrganization(orgData) {
  const organizations = await getAllOrganizations();
  
  // Check if organization name already exists
  const existingOrg = organizations.find(org => 
    org.name.toLowerCase() === orgData.name.toLowerCase()
  );
  
  if (existingOrg) {
    throw new Error('Organization name already exists');
  }
  
  // Create new organization
  const newOrg = {
    id: generateId(),
    name: orgData.name,
    adminId: orgData.adminId,
    configFile: `config-${generateId()}.json`,
    excelFile: `keywords-${generateId()}.xlsx`,
    createdAt: new Date().toISOString()
  };
  
  // Add to organizations array
  organizations.push(newOrg);
  
  // Save to file
  await saveOrganizations(organizations);
  
  // Create org-specific directories and files
  await createOrganizationFiles(newOrg);
  
  return newOrg;
}

// Create organization-specific files
async function createOrganizationFiles(org) {
  const dataDir = path.join(__dirname, '../../data');
  
  // Create config file with default values
  const { config: defaultConfig } = require('../../src/config');
  const orgConfig = {
    ...defaultConfig,
    app: {
      ...defaultConfig.app,
      excelFile: org.excelFile
    }
  };
  
  await fs.writeFile(
    path.join(dataDir, org.configFile), 
    JSON.stringify(orgConfig, null, 2)
  );
  
  // Create empty Excel file structure
  const XLSX = require('xlsx');
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet([]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Keywords');
  XLSX.writeFile(workbook, path.join(dataDir, org.excelFile));
}

// Get organization by ID
async function getOrganizationById(id) {
  const organizations = await getAllOrganizations();
  return organizations.find(org => org.id === id);
}

// Get organization by admin ID
async function getOrganizationByAdminId(adminId) {
  const organizations = await getAllOrganizations();
  return organizations.find(org => org.adminId === adminId);
}

module.exports = {
  getAllOrganizations,
  createOrganization,
  getOrganizationById,
  getOrganizationByAdminId
};