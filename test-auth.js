// Save this as test-auth.js and run it to test just the WordPress authentication
require('dotenv').config();
const axios = require('axios');

async function testWordPressAuth() {
  try {
    // WordPress credentials from .env
    const WP_API_URL = process.env.WP_API_URL || 'https://tastegrove.com/.com/wp-json/wp/v2';
    const WP_USERNAME = process.env.WP_USERNAME || 'benmouad2018';
    const WP_PASSWORD = process.env.WP_PASSWORD;
    
    console.log('Testing WordPress authentication with direct method...');
    console.log(`API URL: ${WP_API_URL}`);
    console.log(`Username: ${WP_USERNAME}`);
    console.log(`Password: ${WP_PASSWORD ? '(Set)' : '(Not set)'}`);
    
    // Method from your working code
    const authString = `${WP_USERNAME}:${WP_PASSWORD}`;
    const encodedAuth = Buffer.from(authString).toString('base64');
    
    console.log('\nSending request to:', `${WP_API_URL}/users/me`);
    console.log('Using authentication header:', `Basic ${encodedAuth.substring(0, 10)}...`);
    
    const response = await axios.get(`${WP_API_URL}/users/me`, {
      headers: {
        'Authorization': `Basic ${encodedAuth}`
      }
    });
    
    console.log('\n✓ Authentication successful!');
    console.log('Response status:', response.status);
    
    // Check and print the user data
    if (response.data) {
      console.log('\nUser details:');
      console.log('- ID:', response.data.id);
      console.log('- Name:', response.data.name);
      
      // Safely check for roles
      if (response.data.roles) {
        if (Array.isArray(response.data.roles)) {
          console.log('- Roles:', response.data.roles.join(', '));
        } else {
          console.log('- Roles:', response.data.roles, '(not an array)');
        }
      } else {
        console.log('- Roles: Not provided in response');
      }
      
      // Print full response structure (but limit length)
      console.log('\nFull response structure:');
      console.log(JSON.stringify(response.data, null, 2).substring(0, 500) + '...');
    } else {
      console.log('Response data is empty or undefined');
    }
    
  } catch (error) {
    console.error('\n✗ Authentication error:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response data:', error.response.data);
    } else {
      console.error('Error details:', error.message);
    }
    
    // Detailed suggestions for common errors
    if (error.message.includes('ENOTFOUND') || error.message.includes('ETIMEDOUT')) {
      console.error('\nSuggestion: The WordPress site URL may be incorrect or not accessible.');
    } else if (error.response && error.response.status === 401) {
      console.error('\nSuggestion: The username or password is incorrect.');
    } else if (error.response && error.response.status === 403) {
      console.error('\nSuggestion: The user does not have sufficient permissions.');
    }
  }
}

// Run the test
console.log('==== WordPress Authentication Test ====');
testWordPressAuth().then(() => {
  console.log('\nTest completed.');
}).catch(err => {
  console.error('Test failed with uncaught error:', err.message);
});