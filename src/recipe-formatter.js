// src/recipe-formatter.js

/**
 * Format recipe data according to custom template
 * @param {Object} recipeData - Original recipe data from AI
 * @param {Object} formatConfig - Custom format configuration
 * @returns {Object} - Formatted recipe data
 */
function formatRecipeData(recipeData, formatConfig) {
  // If no custom formatting is enabled, return original data
  if (!formatConfig || !formatConfig.enabled) {
    return recipeData;
  }
  
  try {
    console.log('Applying custom recipe formatting');
    
    // Create deep copy of recipe data to avoid modifying original
    const formattedRecipe = JSON.parse(JSON.stringify(recipeData));
    
    // Keep original data in separate properties for API compatibility
    formattedRecipe._originalIngredients = [...formattedRecipe.ingredients];
    formattedRecipe._originalInstructions = [...formattedRecipe.instructions];
    
    // Get the custom template
    let customTemplate = formatConfig.customTemplate;
    
    // If template doesn't exist or is empty, use a default template
    if (!customTemplate || customTemplate.trim() === '') {
      customTemplate = '**Ingredients**\n**  **\n* {ingredients}\n\n**Instructions**\n** **\n{instructions}';
    }
    
    // Replace the {ingredients} placeholder with the actual ingredients
    if (customTemplate.includes('{ingredients}')) {
      const ingredientsList = formattedRecipe.ingredients.map(ingredient => `* ${ingredient}`).join('\n');
      customTemplate = customTemplate.replace('{ingredients}', ingredientsList);
    }
    
    // Replace the {instructions} placeholder with the actual instructions
    if (customTemplate.includes('{instructions}')) {
      const instructionsList = formattedRecipe.instructions.map((instruction, index) => 
        `Step ${index + 1}: ${instruction}`
      ).join('\n\n');
      customTemplate = customTemplate.replace('{instructions}', instructionsList);
    }
    
    // Set the formatted content
    formattedRecipe._customFormatted = true;
    formattedRecipe._customTemplate = customTemplate;
    
    return formattedRecipe;
  } catch (error) {
    console.error('Error formatting recipe data:', error);
    // Return original data if formatting fails
    return recipeData;
  }
}

/**
 * Format recipe data using a custom template format while preserving recipe data
 * @param {Object} recipeData - Original recipe data from AI
 * @returns {Object} - Formatted recipe data with custom template
 */
function useFixedTemplate(recipeData) {
  try {
    console.log('Applying custom recipe template with original recipe data');
    
    // Create deep copy of recipe data to avoid modifying original
    const formattedRecipe = JSON.parse(JSON.stringify(recipeData));
    
    // Keep original data in separate properties for API compatibility
    formattedRecipe._originalIngredients = [...formattedRecipe.ingredients];
    formattedRecipe._originalInstructions = [...formattedRecipe.instructions];
    
    // Build ingredient list exactly as per the custom prompt template
    const ingredientsList = formattedRecipe._originalIngredients.map(ingredient => `* ${ingredient}`).join('\n');
    
    // Process instructions to match the custom prompt template format
    // Group instructions into steps if they have step titles
    const processedInstructions = [];
    let currentStep = "";
    let currentStepInstructions = [];
    
    for (const instruction of formattedRecipe._originalInstructions) {
      // Add type checking to handle non-string instructions
      if (instruction === null || instruction === undefined) {
        // Skip null or undefined instructions
        continue;
      }
      
      // Make sure instruction is a string
      const instructionText = String(instruction);
      
      // Check if this instruction is a step title (often starts with "Step" or has a colon)
      if (instructionText.includes(":") || instructionText.startsWith("Step")) {
        // If we already have a step in progress, add it to the processed list before starting new
        if (currentStep && currentStepInstructions.length > 0) {
          processedInstructions.push({
            title: currentStep,
            instructions: [...currentStepInstructions]
          });
          currentStepInstructions = [];
        }
        
        // Set the new current step
        currentStep = instructionText;
      } else {
        // This is a regular instruction, add it to current step
        currentStepInstructions.push(instructionText);
      }
    }
    
    // Don't forget to add the last step if exists
    if (currentStep && currentStepInstructions.length > 0) {
      processedInstructions.push({
        title: currentStep,
        instructions: [...currentStepInstructions]
      });
    }
    
    // If no steps were detected, create default step groups from instructions
    // (this handles flat instruction lists without step titles)
    if (processedInstructions.length === 0 && formattedRecipe._originalInstructions.length > 0) {
      // Create groups of 2-3 instructions per step
      const stepSize = 2;
      for (let i = 0; i < formattedRecipe._originalInstructions.length; i += stepSize) {
        const stepInstructions = formattedRecipe._originalInstructions.slice(i, i + stepSize)
          .map(inst => String(inst)); // Ensure all instructions are strings
        
        if (stepInstructions.length > 0) {
          const stepNumber = Math.floor(i / stepSize) + 1;
          const firstInstruction = stepInstructions[0] || "";
          const stepTitle = `Step ${stepNumber}: ${getStepTitle(stepNumber, firstInstruction)}`;
          
          processedInstructions.push({
            title: stepTitle,
            instructions: stepInstructions
          });
        }
      }
    }
    
    // Now format the instructions according to the template
    const instructionsList = processedInstructions.map(step => {
      const stepTitle = `**${step.title}**`;
      const stepInstructions = step.instructions.map((inst, idx) => 
        `${idx + 1}- ${inst}`
      ).join('\n');
      
      return `${stepTitle}\n${stepInstructions}`;
    }).join('\n\n');
    
    // Build the template using the exact format from the custom prompt
    formattedRecipe._customFormatted = true;
    formattedRecipe._customTemplate = `**Ingredients**
**  **
${ingredientsList}

**Instructions**
** **
${instructionsList}`;
    
    return formattedRecipe;
  } catch (error) {
    console.error('Error applying fixed template:', error);
    // Return original data if formatting fails
    return recipeData;
  }
}

/**
 * Generate a meaningful step title based on the instruction
 * @param {number} stepNumber - Step number
 * @param {string} instruction - The first instruction in the step
 * @returns {string} - A descriptive step title
 */
function getStepTitle(stepNumber, instruction) {
  // Ensure instruction is a string
  instruction = String(instruction || "");
  
  // Common cooking actions that can be used as step titles
  const cookingActions = [
    'Prepare', 'Mix', 'Combine', 'Cook', 'Bake', 'Grill', 'Roast', 'Sauté',
    'Chop', 'Slice', 'Dice', 'Boil', 'Simmer', 'Fry', 'Assemble', 'Serve'
  ];
  
  // Check if instruction contains any of the cooking actions
  for (const action of cookingActions) {
    if (instruction.includes(action) || instruction.includes(action.toLowerCase())) {
      // Extract a few words after the action for a more descriptive title
      const actionIndex = instruction.toLowerCase().indexOf(action.toLowerCase());
      const words = instruction.substring(actionIndex).split(' ').slice(0, 4).join(' ');
      return words;
    }
  }
  
  // Default titles based on common recipe steps if no cooking action is found
  const defaultTitles = {
    1: 'Prepare Ingredients',
    2: 'Mix Components',
    3: 'Cook',
    4: 'Combine',
    5: 'Finish and Serve'
  };
  
  return defaultTitles[stepNumber] || `Step ${stepNumber}`;
}

module.exports = {
  formatRecipeData,
  useFixedTemplate
};