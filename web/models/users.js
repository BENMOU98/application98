// web/models/users.js
// User model and utilities for authentication

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

// File to store user data
const USERS_FILE = path.join(__dirname, '../../data/users.json');

// Create data directory and users file if they don't exist
async function ensureUsersFileExists() {
  try {
    const dataDir = path.join(__dirname, '../../data');
    
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
      const adminUser = {
        id: generateId(),
        username: 'admin',
        // Default password: admin123
        password: hashPassword('admin123'),
        name: 'Administrator',
        email: 'admin@example.com',
        role: 'admin',
        createdAt: new Date().toISOString()
      };
      
      await fs.writeFile(USERS_FILE, JSON.stringify({ users: [adminUser] }, null, 2));
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
    const data = await fs.readFile(USERS_FILE, 'utf8');
    return JSON.parse(data).users;
  } catch (error) {
    console.error('Error loading users:', error);
    return [];
  }
}

// Save all users
async function saveUsers(users) {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2));
  } catch (error) {
    console.error('Error saving users:', error);
    throw error;
  }
}

// Hash password
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Generate user ID
function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

// Get user by ID
async function getUserById(id) {
  const users = await getAllUsers();
  const user = users.find(user => user.id === id);
  
  if (!user) return null;
  
  // Return user without password
  const { password, ...userWithoutPassword } = user;
  return userWithoutPassword;
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

// Update user
async function updateUser(id, userData) {
  const users = await getAllUsers();
  const index = users.findIndex(user => user.id === id);
  
  if (index === -1) {
    throw new Error('User not found');
  }
  
  // Check if username or email already exists
  if (userData.username || userData.email) {
    const existingUser = users.find(user => 
      user.id !== id && (
        (userData.username && user.username === userData.username) || 
        (userData.email && user.email === userData.email)
      )
    );
    
    if (existingUser) {
      if (userData.username && existingUser.username === userData.username) {
        throw new Error('Username already exists');
      } else {
        throw new Error('Email already exists');
      }
    }
  }
  
  // Update user data
  users[index] = {
    ...users[index],
    ...userData,
    // If password is updated, hash it
    ...(userData.password ? { password: hashPassword(userData.password) } : {})
  };
  
  // Save to file
  await saveUsers(users);
  
  // Return user without password
  const { password, ...userWithoutPassword } = users[index];
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

// NEW FUNCTIONS FOR CONTENT OWNERSHIP

// Add ownership information to excel file for new keywords
async function addOwnershipToExcel(excelFile, keywordColumn, keyword, userId) {
  try {
    // Read the Excel file
    const workbook = XLSX.readFile(excelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Find the keyword entry
    const keywordIndex = data.findIndex(row => row[keywordColumn] === keyword);
    
    if (keywordIndex === -1) {
      throw new Error('Keyword not found in Excel file');
    }
    
    // Update the row with ownership information
    data[keywordIndex] = {
      ...data[keywordIndex],
      OwnerId: userId,
      CreatedBy: userId
    };
    
    // Write the updated data back to the Excel file
    const newWorksheet = XLSX.utils.json_to_sheet(data);
    workbook.Sheets[sheetName] = newWorksheet;
    XLSX.writeFile(workbook, excelFile);
    
    return true;
  } catch (error) {
    console.error('Error adding ownership to Excel:', error);
    throw error;
  }
}

// Initialize ownership for existing keywords if needed
async function initializeKeywordOwnership(excelFile, keywordColumn, adminUserId) {
  try {
    // Read the Excel file
    const workbook = XLSX.readFile(excelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    let updated = false;
    
    // Check each row for ownership information
    for (let i = 0; i < data.length; i++) {
      // If no ownership info, add it with admin as default owner
      if (!data[i].OwnerId && !data[i].CreatedBy) {
        data[i].OwnerId = adminUserId;
        data[i].CreatedBy = adminUserId;
        updated = true;
      }
    }
    
    // If any rows were updated, write back to the Excel file
    if (updated) {
      const newWorksheet = XLSX.utils.json_to_sheet(data);
      workbook.Sheets[sheetName] = newWorksheet;
      XLSX.writeFile(workbook, excelFile);
      console.log('Initialized ownership information for existing keywords');
    }
    
    return updated;
  } catch (error) {
    console.error('Error initializing keyword ownership:', error);
    return false;
  }
}

// Transfer ownership of keywords
async function transferKeywordOwnership(excelFile, keywordColumn, keyword, newOwnerId) {
  try {
    // Read the Excel file
    const workbook = XLSX.readFile(excelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Find the keyword entry
    const keywordIndex = data.findIndex(row => row[keywordColumn] === keyword);
    
    if (keywordIndex === -1) {
      throw new Error('Keyword not found in Excel file');
    }
    
    // Update the owner ID
    data[keywordIndex].OwnerId = newOwnerId;
    
    // Write the updated data back to the Excel file
    const newWorksheet = XLSX.utils.json_to_sheet(data);
    workbook.Sheets[sheetName] = newWorksheet;
    XLSX.writeFile(workbook, excelFile);
    
    return true;
  } catch (error) {
    console.error('Error transferring keyword ownership:', error);
    throw error;
  }
}

// Updates needed for web/models/users.js
// Add these new functions and update existing ones

// Add to the existing functions:

// Create organization admin (new user with new organization)
async function createOrganizationAdmin(userData, organizationName) {
  const users = await getAllUsers();
  
  // Check if username or email already exists
  const existingUser = users.find(user => 
    user.username === userData.username || user.email === userData.email
  );
  
  if (existingUser) {
    if (existingUser.username === userData.username) {
      throw new Error('Username already exists');
    } else {
      throw new Error('Email already exists');
    }
  }
  
  // Create new user
  const newUser = {
    id: generateId(),
    username: userData.username,
    password: hashPassword(userData.password),
    name: userData.name,
    email: userData.email,
    role: 'admin', // Set as admin for their organization
    createdAt: new Date().toISOString(),
    organizationId: null // Will be updated after org creation
  };
  
  // Create organization
  const orgModel = require('./organizations');
  const org = await orgModel.createOrganization({
    name: organizationName,
    adminId: newUser.id
  });
  
  // Update user with organization ID
  newUser.organizationId = org.id;
  
  // Add to users array
  users.push(newUser);
  
  // Save to file
  await saveUsers(users);
  
  // Return user without password
  const { password, ...userWithoutPassword } = newUser;
  return { user: userWithoutPassword, organization: org };
}

// Create user function that includes organizationId
async function createUser(userData) {
  const users = await getAllUsers();
  
  // Check if username or email already exists
  const existingUser = users.find(user => 
    user.username === userData.username || user.email === userData.email
  );
  
  if (existingUser) {
    if (existingUser.username === userData.username) {
      throw new Error('Username already exists');
    } else {
      throw new Error('Email already exists');
    }
  }
  
  // Create new user
  const newUser = {
    id: generateId(),
    username: userData.username,
    password: hashPassword(userData.password),
    name: userData.name,
    email: userData.email,
    role: userData.role || 'employee',
    organizationId: userData.organizationId, // Add organization ID
    createdAt: new Date().toISOString()
  };
  
  // Add to users array
  users.push(newUser);
  
  // Save to file
  await saveUsers(users);
  
  // Return user without password
  const { password, ...userWithoutPassword } = newUser;
  return userWithoutPassword;
}

// Get users by organization
async function getUsersByOrganization(organizationId) {
  const users = await getAllUsers();
  return users.filter(user => user.organizationId === organizationId)
    .map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });
}

// Export all functions
module.exports = {
  getAllUsers,
  getUserById,
  authenticateUser,
  createUser, // The version with organizationId support
  updateUser,
  deleteUser,
  hashPassword,
  addOwnershipToExcel,
  initializeKeywordOwnership,
  transferKeywordOwnership,
  createOrganizationAdmin,
  getUsersByOrganization,
  generateId,
  saveUsers
};