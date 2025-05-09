/**
 * Prompt Settings Handler
 * Manages model selections and custom model persistence with validation
 */

// Valid OpenAI models as of May 2025
const VALID_MODELS = [
    // GPT-4 series
    'gpt-4',
    'gpt-4-32k',
    'gpt-4-turbo',
    'gpt-4-turbo-preview',
    'gpt-4-1106-preview',
    'gpt-4-0125-preview',
    'gpt-4-turbo-2024-04-09',
    'gpt-4-vision-preview',
    
    // GPT-4o series
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4o-2024-05-13',
    
    // GPT-4.1 series
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    
    // GPT-3.5 series
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-16k',
    'gpt-3.5-turbo-1106',
    'gpt-3.5-turbo-instruct',
    
    // O1 model
    'o1',
    'o1-preview',
    'o1-mini'
  ];
  
  // Regular expressions for validating custom model names
  const VALID_MODEL_PATTERNS = [
    // Standard GPT pattern with version
    /^gpt-[34](\.\d+)?(-turbo)?(-\d{4}-\d{2}-\d{2})?(-preview)?$/,
    
    // GPT-4o pattern
    /^gpt-4o(-mini)?(-\d{4}-\d{2}-\d{2})?(-preview)?$/,
    
    // GPT-4.1 pattern
    /^gpt-4\.1(-mini)?(-nano)?(-\d{4}-\d{2}-\d{2})?(-preview)?$/,
    
    // O1 pattern
    /^o1(-mini)?(-preview)?$/,
    
    // Fine-tuned model pattern (starts with ft:)
    /^ft:.*$/
  ];
  
  // Initialize prompt settings page
  function initPromptSettings() {
    console.log('Initializing prompt settings...');
    
    // Set up various components
    setupCardToggle();
    setupModelSelection();
    setupTemperatureSlider();
    setupMultiPartToggle();
    setupSeoSettings();
    setupFormSubmission();
  }
  
  // Function to validate if a model name appears to be valid
  function validateModelName(modelName) {
    // Check against our hardcoded list first
    if (VALID_MODELS.includes(modelName)) {
      return true;
    }
    
    // Check against valid patterns for custom/newer models
    return VALID_MODEL_PATTERNS.some(pattern => pattern.test(modelName));
  }
  
  // Setup model selection
  function setupModelSelection() {
    // Load custom models from localStorage first
    loadCustomModels();
    
    // Get the saved model from the hidden input (server-side value)
    const selectedModelInput = document.getElementById('selectedModel');
    const serverSelectedModel = selectedModelInput ? selectedModelInput.value : '';
    console.log('Server has model value:', serverSelectedModel);
    
    // Check localStorage for a saved model preference
    const localStorageModel = localStorage.getItem('selectedModel');
    console.log('localStorage has model value:', localStorageModel);
    
    // Determine which model to select (server value takes precedence)
    let modelToSelect = serverSelectedModel || localStorageModel || 'gpt-4';
    
    // Validate the model to select
    if (!validateModelName(modelToSelect)) {
      console.warn(`Model ${modelToSelect} does not appear to be valid. Defaulting to gpt-4.`);
      modelToSelect = 'gpt-4';
      // Clear invalid model from localStorage
      if (localStorageModel === modelToSelect) {
        localStorage.removeItem('selectedModel');
      }
    }
    
    console.log('Will select model:', modelToSelect);
    
    // Get all model buttons (standard and custom)
    const modelButtons = document.querySelectorAll('.btn-model');
    let modelFound = false;
    
    // Check if the model to select exists as a button
    modelButtons.forEach(button => {
      const buttonModel = button.getAttribute('data-model');
      if (buttonModel === modelToSelect) {
        // This is our model - select it
        modelFound = true;
        console.log('Found existing button for model:', modelToSelect);
      }
      
      // Add click handlers to all model buttons
      button.addEventListener('click', function() {
        selectModel(buttonModel);
      });
    });
    
    // If we didn't find the model but it's a valid custom one, create a button for it
    if (!modelFound && validateModelName(modelToSelect)) {
      createModelButton(modelToSelect);
      console.log('Created new button for custom model:', modelToSelect);
    }
    
    // Now select the appropriate model
    selectModel(modelToSelect);
    
    // Set up custom model addition
    setupCustomModelHandling();
  }
  
  // Create a new model button
  function createModelButton(modelName) {
    if (!modelName) return;
    
    // Validate the model name
    if (!validateModelName(modelName)) {
      console.warn(`Cannot create button for invalid model: ${modelName}`);
      showAlert(`"${modelName}" does not appear to be a valid OpenAI model name.`, 'warning');
      return null;
    }
    
    // Check if this model already exists
    if (document.querySelector(`.btn-model[data-model="${modelName}"]`)) {
      return; // Button already exists
    }
    
    // Find the model selection container and the custom button trigger
    const modelSelection = document.querySelector('.model-selection');
    const customButtonTrigger = document.querySelector('.btn-model-custom');
    
    if (modelSelection && customButtonTrigger) {
      // Create the new button
      const customBtn = document.createElement('button');
      customBtn.type = 'button';
      customBtn.className = 'btn btn-model btn-outline-primary';
      customBtn.setAttribute('data-model', modelName);
      customBtn.setAttribute('data-custom', 'true');
      customBtn.textContent = modelName;
      
      // Add click handler
      customBtn.addEventListener('click', function() {
        selectModel(modelName);
      });
      
      // Insert before the "+ Custom" button
      modelSelection.insertBefore(customBtn, customButtonTrigger);
      
      // Save to localStorage for persistence
      saveCustomModel(modelName);
      
      return customBtn;
    }
    
    return null;
  }
  
  // Setup custom model handling
  function setupCustomModelHandling() {
    const addCustomModelBtn = document.getElementById('addCustomModelBtn');
    
    if (addCustomModelBtn) {
      addCustomModelBtn.addEventListener('click', function() {
        const customModelNameInput = document.getElementById('customModelName');
        if (!customModelNameInput) return;
        
        const customModelName = customModelNameInput.value.trim();
        
        if (customModelName) {
          console.log('Adding custom model:', customModelName);
          
          // Validate the model name
          if (!validateModelName(customModelName)) {
            showAlert(`"${customModelName}" does not appear to be a valid OpenAI model name. Please check the format.`, 'warning');
            return;
          }
          
          // Create button and select the model
          const button = createModelButton(customModelName);
          if (button) {
            // Select the new model
            selectModel(customModelName);
            
            // Clear input
            customModelNameInput.value = '';
            
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('customModelModal'));
            if (modal) modal.hide();
          }
        }
      });
    }
  }
  
  // Function to select a model
  function selectModel(modelName) {
    if (!modelName) return;
    
    // Validate the model
    if (!validateModelName(modelName)) {
      console.warn(`Cannot select invalid model: ${modelName}`);
      showAlert(`"${modelName}" does not appear to be a valid OpenAI model name.`, 'warning');
      return;
    }
    
    console.log('Selecting model:', modelName);
    
    // Update the hidden input field
    const selectedModelInput = document.getElementById('selectedModel');
    if (selectedModelInput) {
      selectedModelInput.value = modelName;
    }
    
    // Update button states - make the selected one active
    const modelButtons = document.querySelectorAll('.btn-model');
    let foundButton = false;
    
    modelButtons.forEach(button => {
      const buttonModel = button.getAttribute('data-model');
      if (buttonModel === modelName) {
        // This button matches our model - activate it
        button.classList.remove('btn-outline-primary');
        button.classList.add('btn-primary');
        foundButton = true;
      } else {
        // Not the selected model - deactivate
        button.classList.remove('btn-primary');
        button.classList.add('btn-outline-primary');
      }
    });
    
    // If we didn't find a matching button but have a valid model name, create one
    if (!foundButton && validateModelName(modelName)) {
      createModelButton(modelName);
    }
    
    // Save to localStorage for persistence across page loads
    localStorage.setItem('selectedModel', modelName);
    console.log('Saved model selection to localStorage:', modelName);
  }
  
  // Function to save custom model to localStorage
  function saveCustomModel(modelName) {
    if (!modelName) return;
    
    // Validate the model
    if (!validateModelName(modelName)) {
      console.warn(`Cannot save invalid model: ${modelName}`);
      return;
    }
    
    let customModels = [];
    
    // Get existing custom models
    try {
      const savedModels = localStorage.getItem('customModels');
      if (savedModels) {
        customModels = JSON.parse(savedModels);
      }
    } catch (e) {
      console.error('Error parsing saved custom models:', e);
      customModels = [];
    }
    
    // Add new model if it doesn't exist
    if (!customModels.includes(modelName)) {
      customModels.push(modelName);
      localStorage.setItem('customModels', JSON.stringify(customModels));
      console.log('Added custom model to localStorage:', modelName);
    }
  }
  
  // Function to load custom models from localStorage
  function loadCustomModels() {
    console.log('Loading custom models from localStorage');
    
    try {
      const savedModels = localStorage.getItem('customModels');
      if (savedModels) {
        const customModels = JSON.parse(savedModels);
        console.log('Found stored custom models:', customModels);
        
        // Filter out invalid models
        const validModels = customModels.filter(model => validateModelName(model));
        
        // If we filtered out any models, update localStorage
        if (validModels.length !== customModels.length) {
          localStorage.setItem('customModels', JSON.stringify(validModels));
          console.log('Removed invalid models from localStorage');
        }
        
        const modelSelection = document.querySelector('.model-selection');
        const customButtonTrigger = document.querySelector('.btn-model-custom');
        
        if (modelSelection && customButtonTrigger && validModels.length > 0) {
          // Add each custom model as a button
          validModels.forEach(modelName => {
            if (modelName && typeof modelName === 'string') {
              // Check if this model already exists
              const existingButton = document.querySelector(`.btn-model[data-model="${modelName}"]`);
              if (!existingButton) {
                createModelButton(modelName);
              }
            }
          });
        }
      }
    } catch (e) {
      console.error('Error loading custom models:', e);
    }
  }
  
  // Toggle card body sections
  function setupCardToggle() {
    const toggleButtons = document.querySelectorAll('.toggle-card-body');
    
    toggleButtons.forEach(button => {
      button.addEventListener('click', function() {
        const icon = this.querySelector('i');
        if (icon.classList.contains('bi-dash-lg')) {
          icon.classList.remove('bi-dash-lg');
          icon.classList.add('bi-plus-lg');
        } else {
          icon.classList.remove('bi-plus-lg');
          icon.classList.add('bi-dash-lg');
        }
      });
    });
  }
  
  // Setup temperature slider
  function setupTemperatureSlider() {
    const temperatureRange = document.getElementById('temperatureRange');
    const temperatureValue = document.getElementById('temperatureValue');
    
    if (temperatureRange && temperatureValue) {
      temperatureRange.addEventListener('input', function() {
        temperatureValue.textContent = this.value;
      });
    }
  }
  
  // Setup SEO settings
  function setupSeoSettings() {
    // Handle SEO temperature slider
    const seoTemperatureRange = document.getElementById('seoModelTemperature');
    const seoTempValue = document.getElementById('seoTempValue');
    
    if (seoTemperatureRange && seoTempValue) {
      seoTemperatureRange.addEventListener('input', function() {
        seoTempValue.textContent = this.value;
      });
    }
  }
  
  // Setup multi-part toggle
  function setupMultiPartToggle() {
    const useMultiPartGeneration = document.getElementById('useMultiPartGeneration');
    const singlePromptSection = document.getElementById('single-prompt-section');
    const multiPartSection = document.getElementById('multi-part-section');
    
    if (useMultiPartGeneration && singlePromptSection && multiPartSection) {
      useMultiPartGeneration.addEventListener('change', function() {
        if (this.checked) {
          singlePromptSection.classList.add('d-none');
          multiPartSection.classList.remove('d-none');
          
          // Update badge if it exists
          const badge = document.querySelector('.badge');
          if (badge) {
            badge.textContent = 'Multi-Part';
            badge.classList.remove('bg-success');
            badge.classList.add('bg-primary');
          }
        } else {
          singlePromptSection.classList.remove('d-none');
          multiPartSection.classList.add('d-none');
          
          // Update badge if it exists
          const badge = document.querySelector('.badge');
          if (badge) {
            badge.textContent = 'Single-Part';
            badge.classList.remove('bg-primary');
            badge.classList.add('bg-success');
          }
        }
      });
    }
  }
  
  // Setup form submission
  function setupFormSubmission() {
    const promptSettingsForm = document.getElementById('prompt-settings-form');
    
    if (promptSettingsForm) {
      promptSettingsForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Get the current model from the hidden input
        const currentModel = document.getElementById('selectedModel').value;
        
        // Validate the model before submission
        if (!validateModelName(currentModel)) {
          showAlert(`"${currentModel}" does not appear to be a valid OpenAI model. Please select a valid model.`, 'danger');
          return;
        }
        
        console.log('Submitting form with model:', currentModel);
        
        // Collect form data
        const formData = {
          // Original form data
          useMultiPartGeneration: document.getElementById('useMultiPartGeneration') ? document.getElementById('useMultiPartGeneration').checked : false,
          // System, user prompts and model settings
          systemPrompt: document.getElementById('systemPrompt').value,
          userPrompt: document.getElementById('userPrompt').value,
          model: currentModel, // Use the value from the hidden input
          temperature: document.getElementById('temperatureRange').value,
          maxTokens: document.getElementById('maxTokens') ? document.getElementById('maxTokens').value : '4000',
          // Single and multi-part prompts
          mainPrompt: document.getElementById('mainPrompt') ? document.getElementById('mainPrompt').value : '',
          part1Prompt: document.getElementById('part1Prompt') ? document.getElementById('part1Prompt').value : '',
          part2Prompt: document.getElementById('part2Prompt') ? document.getElementById('part2Prompt').value : '',
          part3Prompt: document.getElementById('part3Prompt') ? document.getElementById('part3Prompt').value : '',
          
          // Add SEO settings
          seoSystemPrompt: document.getElementById('seoSystemPrompt') ? document.getElementById('seoSystemPrompt').value : '',
          seoTitlePrompt: document.getElementById('seoTitlePrompt') ? document.getElementById('seoTitlePrompt').value : '',
          seoDescriptionPrompt: document.getElementById('seoDescriptionPrompt') ? document.getElementById('seoDescriptionPrompt').value : '',
          seoPermalinkPrompt: document.getElementById('seoPermalinkPrompt') ? document.getElementById('seoPermalinkPrompt').value : '',
          seoModelTemperature: document.getElementById('seoModelTemperature') ? document.getElementById('seoModelTemperature').value : '0.7',
          seoModelName: document.getElementById('seoModelName') ? document.getElementById('seoModelName').value : 'gpt-4',
          
          // Keep these empty but include them to avoid backend errors
          toneVoice: "",
          seoGuidelines: "",
          thingsToAvoid: "",
          articleFormat: "",
          useArticleFormat: false,
          enableRecipeDetection: false,
          recipeFormatPrompt: ""
        };
        
        // Save prompt settings
        fetch('/api/save-prompt-settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(formData)
        })
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            // Success - ensure model is saved to localStorage too
            localStorage.setItem('selectedModel', currentModel);
            showAlert('Prompt settings saved successfully!', 'success');
          } else {
            showAlert(`Failed to save prompt settings: ${data.error}`, 'danger');
          }
        })
        .catch(error => {
          showAlert(`Error saving prompt settings: ${error.message}`, 'danger');
        });
      });
    }
  }
  
  // Function to show alert message
  function showAlert(message, type) {
    // Create alert container if it doesn't exist
    let alertContainer = document.querySelector('.alert-container');
    if (!alertContainer) {
      alertContainer = document.createElement('div');
      alertContainer.className = 'alert-container position-fixed top-0 end-0 p-3';
      document.body.appendChild(alertContainer);
    }
    
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.role = 'alert';
    alertDiv.innerHTML = `
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    
    alertContainer.appendChild(alertDiv);
    
    // Auto dismiss after 5 seconds
    setTimeout(() => {
      const bootstrapAlert = bootstrap.Alert.getInstance(alertDiv);
      if (bootstrapAlert) {
        bootstrapAlert.close();
      } else {
        alertDiv.remove();
      }
    }, 5000);
  }
  
  // Initialize when the DOM is loaded
  document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on the prompt settings page
    if (document.getElementById('prompt-settings-form')) {
      console.log('Initializing prompt settings page');
      initPromptSettings();
    }
  });