// web/middleware/auth.js
// Authentication and authorization middleware

const orgModel = require('../models/organizations');
const { config } = require('../../src/config');
const path = require('path');
const fs = require('fs').promises;

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  
  // Store original URL to redirect after login
  // Check if req.session exists before setting properties
  if (req.session) {
    req.session.returnTo = req.originalUrl;
  }
  
  // Flash message if available
  if (req.flash) {
    req.flash('error', 'Please log in to access this page');
  }
  
  return res.redirect('/login');
}

// Middleware to check if user is an admin
function isAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  
  // Flash message if available
  if (req.flash) {
    req.flash('error', 'You need admin privileges to access this page');
  }
  
  // If logged in but not admin, go to dashboard, otherwise login
  if (req.session && req.session.user) {
    return res.redirect('/');
  } else {
    return res.redirect('/login');
  }
}

// Middleware to check if user is an employee
function isEmployee(req, res, next) {
  if (req.session && req.session.user && 
     (req.session.user.role === 'employee' || req.session.user.role === 'admin')) {
    return next();
  }
  
  // Flash message if available
  if (req.flash) {
    req.flash('error', 'You need employee privileges to access this page');
  }
  
  // If logged in but not employee, go to dashboard, otherwise login
  if (req.session && req.session.user) {
    return res.redirect('/');
  } else {
    return res.redirect('/login');
  }
}

// Middleware to check if user owns the resource or is an admin
function isResourceOwner(req, res, next) {
  // If user is an admin, always allow access
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  
  // For employees, check if they are accessing their own data
  if (req.session && req.session.user && req.session.user.role === 'employee') {
    // Set userId in request for filtering data in routes
    req.ownerId = req.session.user.id;
    return next();
  }
  
  // If not authorized
  if (req.flash) {
    req.flash('error', 'You do not have permission to access this resource');
  }
  
  // If logged in but not authorized, go to dashboard, otherwise login
  if (req.session && req.session.user) {
    return res.redirect('/');
  } else {
    return res.redirect('/login');
  }
}

// Add organization to request
async function attachOrganizationToRequest(req, res, next) {
  if (req.session && req.session.user) {
    try {
      // Get user's organization
      const organization = await orgModel.getOrganizationById(req.session.user.organizationId);
      
      if (organization) {
        req.organization = organization;
        
        // Load organization-specific config
        const configPath = path.join(__dirname, '../../data', organization.configFile);
        try {
          const orgConfigData = await fs.readFile(configPath, 'utf8');
          req.orgConfig = JSON.parse(orgConfigData);
        } catch (error) {
          // If org config doesn't exist, use default config
          req.orgConfig = config;
        }
        
        // Set organization Excel file path
        req.orgExcelFile = path.join(__dirname, '../../data', organization.excelFile);
      } else {
        // For users without organization (legacy), use default config
        req.orgConfig = config;
        req.orgExcelFile = config.app.excelFile;
      }
    } catch (error) {
      console.error('Error attaching organization:', error);
      // Fallback to default config
      req.orgConfig = config;
      req.orgExcelFile = config.app.excelFile;
    }
  }
  next();
}

// Check if user belongs to the same organization
function isSameOrganization(req, res, next) {
  if (req.session && req.session.user) {
    // For resource-specific routes, check organization match
    const targetUserId = req.params.userId;
    if (targetUserId) {
      // In a real implementation, you'd verify the target user belongs to the same org
      // For now, we'll let it pass through
    }
    return next();
  }
  
  if (req.flash) {
    req.flash('error', 'You do not have permission to access this resource');
  }
  
  return res.redirect('/login');
}

// Middleware for user data in views
function attachUserToLocals(req, res, next) {
  // Make user and organization data available to all views
  res.locals.user = req.session.user || null;
  res.locals.organization = req.organization || null;
  res.locals.orgConfig = req.orgConfig || config;
  next();
}

module.exports = {
  isAuthenticated,
  isAdmin,
  isEmployee,
  isResourceOwner,
  attachUserToLocals,
  attachOrganizationToRequest,
  isSameOrganization
};