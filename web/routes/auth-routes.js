// web/routes/auth-routes.js
// Routes for authentication

const express = require('express');
const router = express.Router();
const userModel = require('../models/users');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Login page
router.get('/login', (req, res) => {
  // Redirect if already logged in
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  
  res.render('login', {
    page: 'login',
    error: req.flash ? req.flash('error') : null,
    success: req.flash ? req.flash('success') : null
  });
});

// Login form submission
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      if (req.flash) req.flash('error', 'Please provide both username and password');
      return res.redirect('/login');
    }
    
    // Authenticate user
    const user = await userModel.authenticateUser(username, password);
    
    if (!user) {
      if (req.flash) req.flash('error', 'Invalid username or password');
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
    if (req.flash) req.flash('error', 'Login failed: ' + error.message);
    res.redirect('/login');
  }
});

// Logout
router.get('/logout', (req, res) => {
  // Destroy session
  req.session.destroy(err => {
    if (err) {
      console.error('Error during logout:', err);
    }
    res.redirect('/login');
  });
});

// User management page (admin only)
router.get('/users', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const users = await userModel.getAllUsers();
    
    res.render('users', {
      page: 'users',
      users,
      error: req.flash ? req.flash('error') : null,
      success: req.flash ? req.flash('success') : null
    });
  } catch (error) {
    console.error('Error loading users page:', error);
    if (req.flash) req.flash('error', 'Failed to load users: ' + error.message);
    res.redirect('/');
  }
});

// Create user (admin only)
router.post('/users', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { username, password, name, email, role } = req.body;
    
    // Validate required fields
    if (!username || !password || !name || !email || !role) {
      if (req.flash) req.flash('error', 'All fields are required');
      return res.redirect('/users');
    }
    
    // Create user
    await userModel.createUser({
      username,
      password,
      name,
      email,
      role
    });
    
    if (req.flash) req.flash('success', 'User created successfully');
    res.redirect('/users');
  } catch (error) {
    console.error('Error creating user:', error);
    if (req.flash) req.flash('error', 'Failed to create user: ' + error.message);
    res.redirect('/users');
  }
});

// Update user (admin only)
router.post('/users/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, password } = req.body;
    
    // Validate required fields
    if (!name || !email || !role) {
      if (req.flash) req.flash('error', 'Name, email and role are required');
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
    
    if (req.flash) req.flash('success', 'User updated successfully');
    res.redirect('/users');
  } catch (error) {
    console.error('Error updating user:', error);
    if (req.flash) req.flash('error', 'Failed to update user: ' + error.message);
    res.redirect('/users');
  }
});

// Delete user (admin only)
router.post('/users/:id/delete', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Don't allow deleting own account
    if (id === req.session.user.id) {
      if (req.flash) req.flash('error', 'You cannot delete your own account');
      return res.redirect('/users');
    }
    
    // Delete user
    await userModel.deleteUser(id);
    
    if (req.flash) req.flash('success', 'User deleted successfully');
    res.redirect('/users');
  } catch (error) {
    console.error('Error deleting user:', error);
    if (req.flash) req.flash('error', 'Failed to delete user: ' + error.message);
    res.redirect('/users');
  }
});

// My profile page
router.get('/profile', isAuthenticated, (req, res) => {
  res.render('profile', {
    page: 'profile',
    error: req.flash ? req.flash('error') : null,
    success: req.flash ? req.flash('success') : null
  });
});

// Update profile
router.post('/profile', isAuthenticated, async (req, res) => {
  try {
    const { name, email, currentPassword, newPassword } = req.body;
    
    // Validate required fields
    if (!name || !email) {
      if (req.flash) req.flash('error', 'Name and email are required');
      return res.redirect('/profile');
    }
    
    // Update data
    const updateData = { name, email };
    
    // If changing password, validate current password
    if (newPassword) {
      if (!currentPassword) {
        if (req.flash) req.flash('error', 'Current password is required to set a new password');
        return res.redirect('/profile');
      }
      
      // Get all users to verify password
      const users = await userModel.getAllUsers();
      const user = users.find(u => u.id === req.session.user.id);
      
      if (!user || user.password !== userModel.hashPassword(currentPassword)) {
        if (req.flash) req.flash('error', 'Current password is incorrect');
        return res.redirect('/profile');
      }
      
      // Password is correct, update it
      updateData.password = newPassword;
    }
    
    // Update user
    const updatedUser = await userModel.updateUser(req.session.user.id, updateData);
    
    // Update session
    req.session.user = updatedUser;
    
    if (req.flash) req.flash('success', 'Profile updated successfully');
    res.redirect('/profile');
  } catch (error) {
    console.error('Error updating profile:', error);
    if (req.flash) req.flash('error', 'Failed to update profile: ' + error.message);
    res.redirect('/profile');
  }
});

module.exports = router;

// Add this route to your auth-routes.js file

// Admin employee dashboard route for monitoring employee activities
router.get('/admin/employee-dashboard', isAuthenticated, isAdmin, async (req, res) => {
  try {
    // Get all employees
    const allUsers = await userModel.getAllUsers();
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
        const excelFileExists = await fileExists(config.app.excelFile);
        
        if (excelFileExists) {
          const workbook = XLSX.readFile(config.app.excelFile);
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
          
          // Create dummy activity log for now
          activityLog = createDummyActivityLog(keywords, publications, selectedEmployeeId);
          
          // Count today's activity
          const today = new Date().toISOString().split('T')[0];
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
      keywordColumn: config.app.keywordColumn,
      error: req.flash ? req.flash('error') : null,
      success: req.flash ? req.flash('success') : null
    });
  } catch (error) {
    console.error('Error loading employee dashboard:', error);
    if (req.flash) req.flash('error', 'Error loading employee dashboard: ' + error.message);
    res.redirect('/');
  }
});

// Add these required dependencies at the top of auth-routes.js
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs').promises;

// Add this helper function
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Add this helper function
function createDummyActivityLog(keywords, publications, employeeId) {
  const log = [];
  
  // Add keyword creation log entries
  keywords.forEach(keyword => {
    if (keyword.CreatedBy === employeeId) {
      log.push({
        type: 'info',
        timestamp: keyword.CreatedAt || new Date().toISOString(),
        message: `Created keyword: "${keyword[config.app.keywordColumn]}"`
      });
    }
  });
  
  // Add publication log entries
  publications.forEach(pub => {
    log.push({
      type: 'success',
      timestamp: pub['Publication Date'] || new Date().toISOString(),
      message: `Published article for: "${pub[config.app.keywordColumn]}"`
    });
  });
  
  // Sort by timestamp (newest first)
  return log.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}