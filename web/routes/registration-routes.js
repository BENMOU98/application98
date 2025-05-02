// web/routes/registration-routes.js
// Routes for user registration and organization creation

const express = require('express');
const router = express.Router();
const userModel = require('../models/users');

// Registration page
router.get('/register', (req, res) => {
  // Redirect if already logged in
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  
  res.render('register', {
    error: req.flash ? req.flash('error') : null,
    success: req.flash ? req.flash('success') : null
  });
});

// Registration form submission
router.post('/register', async (req, res) => {
  try {
    const { 
      organizationName, 
      name, 
      email, 
      username, 
      password, 
      confirmPassword 
    } = req.body;
    
    // Validation
    if (!organizationName || !name || !email || !username || !password || !confirmPassword) {
      if (req.flash) req.flash('error', 'All fields are required');
      return res.redirect('/register');
    }
    
    if (password !== confirmPassword) {
      if (req.flash) req.flash('error', 'Passwords do not match');
      return res.redirect('/register');
    }
    
    if (password.length < 8) {
      if (req.flash) req.flash('error', 'Password must be at least 8 characters long');
      return res.redirect('/register');
    }
    
    // Create organization admin and organization
    const { user, organization } = await userModel.createOrganizationAdmin(
      { username, password, name, email },
      organizationName
    );
    
    // Set user in session
    req.session.user = user;
    
    if (req.flash) req.flash('success', 'Account created successfully! Welcome to your new organization.');
    
    // Redirect to setup page or dashboard
    res.redirect('/');
  } catch (error) {
    console.error('Registration error:', error);
    if (req.flash) req.flash('error', error.message || 'Registration failed');
    res.redirect('/register');
  }
});

module.exports = router;