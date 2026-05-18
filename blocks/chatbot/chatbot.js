/**
 * ChatbotV1 - AI-Powered Direct DA HTML Content Updater
 * 
 * This chatbot uses AI intelligence to:
 * 1. Analyze HTML structure
 * 2. Understand user intent
 * 3. Decide what to update
 * 4. Generate content dynamically
 * 5. Update DA HTML directly
 * 
 * Positioned on the LEFT side of the screen
 */

// Speech Recognition setup
let recognition = null;
let isListening = false;
let speechTimeout = null;
let accumulatedTranscript = '';
const SPEECH_DELAY_MS = 3000; // Wait 3 seconds of silence before sending

// ============================================================================
// CONFIGURATION
// ============================================================================

// Repository Configuration
const ORG = 'meejain';
const REPO = 'speech-ai-chatbot';

// Dynamically detect which page we're on
function getHTMLFile() {
  const pathname = window.location.pathname;
  // Remove leading slash and use 'index' if at root
  const file = pathname === '/' ? 'index' : pathname.substring(1);
  console.log(`📄 Detected page: ${file}`);
  return file;
}

const HTML_FILE = getHTMLFile();

// ============================================================================
// INTEGRATION MODE SELECTION
// ============================================================================
// Choose your integration approach:
// - 'DIRECT_OPENAI': Call OpenAI APIs directly from browser (default)
// - 'POWER_AUTOMATE': Use Microsoft Power Automate workflow (commented out below)
//
// To use Power Automate:
// 1. Set: const INTEGRATION_MODE = 'POWER_AUTOMATE';
// 2. Uncomment the Power Automate section at the bottom of this file
// 3. Set your POWER_AUTOMATE_URL
// ============================================================================

const INTEGRATION_MODE = 'DIRECT_OPENAI'; // Change to 'POWER_AUTOMATE' if using Power Automate

// AI Configuration cache
let cachedAIConfig = null;
let cachedDAToken = null;

/**
 * Extract page structure for AI analysis
 * Now includes block types (cards, columns, carousel, etc.)
 */
function extractPageStructure(html) {
  const structure = {
    headings: [],
    sections: []
  };
  
  // Extract all headings with context and block types
  const headingRegex = /<(h[123])>([^<]+)<\/\1>/g;
  let match;
  let position = 0;
  
  while ((match = headingRegex.exec(html)) !== null) {
    const level = match[1]; // h1, h2, h3
    const text = match[2];
    const headingIndex = match.index;
    
    // Look ahead to detect block type
    const afterHeading = html.substring(headingIndex, headingIndex + 1000);
    let blockType = 'simple';
    
    // Detect block types by class attributes
    if (afterHeading.includes('class="cards"')) {
      blockType = 'cards';
    } else if (afterHeading.includes('class="columns"')) {
      blockType = 'columns';
    } else if (afterHeading.includes('class="carousel"')) {
      blockType = 'carousel';
    } else if (level === 'h1') {
      blockType = 'hero';
    }
    
    // Count images after this heading
    const imageCount = (afterHeading.match(/assets\//g) || []).length;
    
    structure.headings.push({
      level: level,
      text: text,
      position: position++,
      blockType: blockType,
      imageCount: imageCount
    });
  }
  
  return structure;
}

/**
 * Ask AI to analyze the request and generate a transformation plan
 * Returns structured instructions (not code) to avoid CSP eval restrictions
 */
async function askAIToGeneratePlan(userPrompt, htmlSnippet, pageStructure) {
  console.log('🤖 Asking AI to analyze and create transformation plan...');
  console.log('📋 Page Structure sent to AI:', JSON.stringify(pageStructure, null, 2));
  console.log('💬 User Prompt:', userPrompt);
  
  const systemPrompt = `You are an intelligent content transformation planner for HTML documents.

USER WILL PROVIDE:
1. HTML structure with headings
2. What they want to change
3. User's natural language request

YOUR TASK:
Analyze the request and generate INSTRUCTIONS (not code) as JSON. Return a JSON object with:

{
  "targetHeading": "exact heading text from HTML to update",
  "action": "update_hero" or "update_section" or "update_columns",
  "newHeading": "new heading text (optional)",
  "replaceAll": true or false,
  "targetPosition": null or number (1-based: 1 for first, 2 for second, etc.),
  "items": [
    {
      "imageDescription": "detailed DALL-E prompt for realistic image generation",
      "textContent": "compelling paragraph of text about this subject"
    }
  ]
}

RULES:
- **CRITICAL**: Use EXACT heading text from the HTML structure provided
- **CRITICAL**: Pay attention to the "blockType" field in the structure:
  - blockType: "cards" → This is a Cards section
  - blockType: "columns" → This is a Columns section
  - blockType: "carousel" → This is a Carousel section
  - blockType: "hero" → This is the Hero section
  - blockType: "simple" → This is a simple text section
- **MATCH USER INTENT TO BLOCK TYPE**:
  - If user says "cards" or "card elements", choose a heading with blockType="cards"
  - If user says "columns", choose a heading with blockType="columns"
  - If user says "carousel", choose a heading with blockType="carousel"
- For "update_hero", target the heading with blockType="hero"
- **POSITIONAL UPDATES**: If user says "2nd card", "first column", "third item", etc., set replaceAll=false and targetPosition to that number
- **REPLACE ALL**: If user says "update cards with Paris and London" or no position mentioned, set replaceAll=true and targetPosition=null
- **IMPORTANT: Only generate images if the user specifically mentions visual elements, cities, places, or topics that need illustration**
- If user only wants to update TEXT (e.g., "update the text", "change the content"), set imageDescription to null or empty string
- Create DETAILED DALL-E prompts ONLY when images are needed (e.g., "Professional travel photography of Eiffel Tower at sunset, golden hour lighting, vivid colors, high quality, 4k")
- Generate COMPELLING text content (2-3 sentences minimum)
- If user mentions multiple cities/topics, create multiple items

EXAMPLES:
- "Update hero with Paris" → Find heading with blockType="hero", Generate image + text
- "Update cards with London, Paris, Milan" → Find heading with blockType="cards", Generate 3 items
- "Update 2nd card with San Francisco" → Find heading with blockType="cards", targetPosition=2
- "Update first column with London" → Find heading with blockType="columns", targetPosition=1
- "Under Boilerplate Highlights section - change card elements" → Find "Boilerplate Highlights" with blockType="cards"

Be specific and use actual heading text AND blockType from the HTML.`;

  const userMessage = `Page Structure (All headings in the document):
${JSON.stringify(pageStructure, null, 2)}

HTML Sample (first 1000 chars):
${htmlSnippet.substring(0, 1000)}

User Request: "${userPrompt}"

CRITICAL INSTRUCTIONS:
1. Look at the "blockType" field for EACH heading
2. If user mentions "cards" or "card elements", find the heading where blockType="cards"
3. If user mentions "columns", find the heading where blockType="columns"
4. Use the EXACT heading text from the structure above

Analyze this request and return a JSON plan with:
- targetHeading: EXACT text from structure (must match blockType user mentioned)
- action: update_hero / update_section / update_columns
- Detailed DALL-E image prompts
- Compelling text content

Return ONLY valid JSON, nothing else.`;

  const aiConfig = await getAIConfig();
  if (!aiConfig || !aiConfig.OPENAI_TOKEN) {
    throw new Error('OpenAI configuration not available');
  }

  try {
    console.log('🤖 Calling OpenAI GPT-4 API...');
    console.log('Endpoint:', aiConfig.OPENAI_CHAT_URI);
    
    // OpenAI Chat Completions API call
    const response = await fetch(aiConfig.OPENAI_CHAT_URI || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.OPENAI_TOKEN}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    });

    console.log('Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error response:', errorText);
      throw new Error(`OpenAI GPT-4 API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content.trim();
    
    console.log('🤖 Full AI Response:', aiResponse);
    
    // Extract JSON from response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('AI response did not contain JSON:', aiResponse);
      throw new Error('AI did not return valid JSON with code');
    }
    
    console.log('📦 Extracted JSON:', jsonMatch[0]);
    const result = JSON.parse(jsonMatch[0]);
    console.log('✅ Parsed AI Plan:');
    console.log('   targetHeading:', result.targetHeading);
    console.log('   action:', result.action);
    console.log('   items count:', result.items?.length || 0);
    console.log('✅ AI generated transformation plan');
    
    return result;
    
  } catch (error) {
    console.error('AI code generation failed:', error);
    
    // Check for CORS or network errors
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('Network error: Cannot reach OpenAI API. Please check your internet connection.');
    }
    
    throw new Error(`AI plan generation failed: ${error.message}`);
  }
}

/**
 * Generate image using DALL-E 3
 * Returns base64 data to avoid CORS issues
 */
async function generateImageWithDALLE(description) {
  console.log(`🎨 Generating image: "${description.substring(0, 50)}..."`);
  
  const aiConfig = await getAIConfig();
  if (!aiConfig || !aiConfig.OPENAI_TOKEN) {
    throw new Error('OpenAI configuration not available');
  }
  
  try {
    const response = await fetch(aiConfig.OPENAI_IMAGE_URI || 'https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.OPENAI_TOKEN}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: description,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
        style: 'vivid',
        response_format: 'b64_json' // Get base64 instead of URL to avoid CORS
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`DALL-E error: ${error.error?.message || response.status}`);
    }

    const data = await response.json();
    const base64Image = data.data[0].b64_json;
    
    console.log(`✅ Image generated successfully (base64)`);
    return base64Image;
    
  } catch (error) {
    console.error('Image generation failed:', error);
    throw new Error(`Failed to generate image: ${error.message}`);
  }
}

/**
 * Update hero section - SIMPLE APPROACH
 * Just find and replace the image link and heading in the first div
 */
function updateHeroSection(html, targetHeading, newHeading, imageUrls, textContents, replaceAll = true, targetPosition = null) {
  console.log('🔍 Updating hero section (simple replace)');
  console.log('New heading:', newHeading);
  console.log('New image:', imageUrls[0]);
  
  // Find the first div inside <main> - this is the hero section
  const heroMatch = html.match(/<main>[\s\S]*?(<div>[\s\S]*?<\/div>)/);
  if (!heroMatch) {
    console.warn('Could not find hero section');
    return html;
  }
  
  let oldHeroSection = heroMatch[1];
  let newHeroSection = oldHeroSection;
  
  console.log('OLD hero:', oldHeroSection);
  
  // 1. Replace the image link (find any <a href="...">...</a> and replace it)
  if (imageUrls.length > 0 && imageUrls[0]) {
    newHeroSection = newHeroSection.replace(
      /<a href="[^"]*">[^<]*<\/a>/,
      `<a href="${imageUrls[0]}">${imageUrls[0]}</a>`
    );
    console.log('✅ Replaced image link');
  }
  
  // 2. Replace the h1 heading
  if (newHeading) {
    newHeroSection = newHeroSection.replace(
      /<h1[^>]*>.*?<\/h1>/,
      `<h1>${newHeading}</h1>`
    );
    console.log('✅ Replaced heading');
  }
  
  // 3. Add or replace text content (any <p> that doesn't contain <a>)
  if (textContents.length > 0 && textContents[0]) {
    // Check if there's already a text paragraph (not containing a link)
    const hasTextParagraph = /<p>(?!<a)[^<].*?<\/p>/.test(newHeroSection);
    
    if (hasTextParagraph) {
      // Replace existing text paragraph
      newHeroSection = newHeroSection.replace(
        /<p>(?!<a)([^<].*?)<\/p>/,
        `<p>${textContents[0]}</p>`
      );
      console.log('✅ Replaced text content');
    } else {
      // Add new text paragraph before closing </div>
      newHeroSection = newHeroSection.replace(
        /<\/div>$/,
        `<p>${textContents[0]}</p></div>`
      );
      console.log('✅ Added text content');
    }
  }
  
  console.log('NEW hero:', newHeroSection);
  
  // Replace the old hero section with the new one in the full HTML
  const result = html.replace(oldHeroSection, newHeroSection);
  
  console.log('✅ Hero section updated');
  
  return result;
}

/**
 * Update any section by finding its heading - SIMPLE APPROACH
 * Just find and replace image links and text content
 * @param {boolean} replaceAll - If true, replace all items; if false, update only targetPosition
 * @param {number|null} targetPosition - 1-based position (e.g., 2 for "2nd card")
 */
function updateSectionByHeading(html, targetHeading, newHeading, imageUrls, textContents, replaceAll = true, targetPosition = null) {
  console.log('🔍 Updating section (simple replace):', { 
    targetHeading, 
    newHeading, 
    imageCount: imageUrls.length, 
    replaceAll,
    targetPosition
  });
  
  if (!targetHeading) {
    throw new Error('Target heading not specified');
  }
  
  // Find the section by heading
  const headingPattern = targetHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  
  // Better approach: Find the heading first, then find its parent section
  const headingRegex = new RegExp(`<h[123]>${headingPattern}<\\/h[123]>`, 'i');
  const headingMatch = html.match(headingRegex);
  
  if (!headingMatch) {
    console.error('Could not find heading:', targetHeading);
    throw new Error(`Could not find heading: "${targetHeading}"`);
  }
  
  const headingIndex = html.indexOf(headingMatch[0]);
  console.log(`Found heading "${targetHeading}" at index ${headingIndex}`);
  
  // Find the <div> that contains this heading (look backwards)
  const beforeHeading = html.substring(0, headingIndex);
  const lastDivIndex = beforeHeading.lastIndexOf('<div>');
  
  if (lastDivIndex === -1) {
    throw new Error('Could not find parent div for section');
  }
  
  console.log(`Section starts at index ${lastDivIndex}`);
  
  // Find the matching closing </div> after the heading
  const afterDivOpen = html.substring(lastDivIndex + 5); // after '<div>'
  let depth = 0;
  let pos = 0;
  let closingDivPos = -1;
  
  while (pos < afterDivOpen.length) {
    if (afterDivOpen.substring(pos, pos + 5) === '<div>') {
      depth++;
      pos += 5;
    } else if (afterDivOpen.substring(pos, pos + 6) === '</div>') {
      if (depth === 0) {
        closingDivPos = pos;
        break;
      }
      depth--;
      pos += 6;
    } else {
      pos++;
    }
  }
  
  if (closingDivPos === -1) {
    throw new Error('Could not find closing div for section');
  }
  
  const sectionEndIndex = lastDivIndex + 5 + closingDivPos + 6; // include '</div>'
  let oldSection = html.substring(lastDivIndex, sectionEndIndex);
  let newSection = oldSection;
  
  console.log('Found section, length:', oldSection.length, 'chars');
  console.log('Section starts with:', oldSection.substring(0, 100));
  console.log('Section contains heading?', oldSection.includes(targetHeading));
  
  // 1. Replace the heading if provided
  if (newHeading) {
    newSection = newSection.replace(
      /<h[123]>[^<]*<\/h[123]>/i,
      (match) => match.replace(/>[^<]*</, `>${newHeading}<`)
    );
    console.log('✅ Replaced heading');
  }
  
  // 2. Check if this is a block structure (Cards, Columns, etc.)
  const hasBlockStructure = /<div class="(cards|columns|carousel)">/i.test(newSection);
  
  if (hasBlockStructure && !replaceAll && targetPosition) {
    // Selective update: Update only the Nth item
    console.log(`Updating only item #${targetPosition}`);
    newSection = updateNthItem(newSection, targetPosition, imageUrls[0], textContents[0]);
  } else if (hasBlockStructure) {
    // Replace all items in block structure
    console.log('Block structure detected, replacing all items');
    newSection = updateAllBlockItems(newSection, imageUrls, textContents);
  } else {
    // Simple section: just replace paragraphs
    console.log('Simple section, replacing paragraphs');
    newSection = updateSimpleParagraphs(newSection, imageUrls, textContents);
  }
  
  // Replace the old section with new section in full HTML
  const result = html.replace(oldSection, newSection);
  
  console.log('✅ Section updated');
  return result;
}

/**
 * Update the Nth item in a block (e.g., "2nd card")
 * Simple find and replace approach
 */
function updateNthItem(sectionHtml, position, imageUrl, textContent) {
  console.log(`🎯 Updating item #${position}`);
  
  // Find all card/column divs (pattern: <div><div>...</div><div>...</div></div>)
  const itemPattern = /<div>\s*<div>[\s\S]*?<\/div>\s*<div>[\s\S]*?<\/div>\s*<\/div>/g;
  const items = sectionHtml.match(itemPattern);
  
  if (!items || items.length < position) {
    console.warn(`Only found ${items?.length || 0} items, cannot update position ${position}`);
    return sectionHtml;
  }
  
  const oldItem = items[position - 1]; // Convert to 0-based
  let newItem = oldItem;
  
  // Replace image if provided
  if (imageUrl) {
    newItem = newItem.replace(
      /<a href="[^"]*">[^<]*<\/a>/,
      `<a href="${imageUrl}">${imageUrl}</a>`
    );
  }
  
  // Replace text if provided
  if (textContent) {
    // Find the text paragraph (usually the second <div> or after <strong>)
    newItem = newItem.replace(
      /(<p>(?:<strong>[^<]*<\/strong>)?)[^<]*(<\/p>)/,
      `$1${textContent}$2`
    );
  }
  
  console.log(`✅ Updated item #${position}`);
  return sectionHtml.replace(oldItem, newItem);
}

/**
 * Update all items in a block structure (Cards, Columns)
 * Simple find and replace approach
 */
function updateAllBlockItems(sectionHtml, imageUrls, textContents) {
  console.log(`🔄 Updating all block items (${Math.max(imageUrls.length, textContents.length)} items)`);
  
  // Find all card/column divs
  const itemPattern = /<div>\s*<div>[\s\S]*?<\/div>\s*<div>[\s\S]*?<\/div>\s*<\/div>/g;
  const items = sectionHtml.match(itemPattern);
  
  if (!items) {
    console.warn('No block items found');
    return sectionHtml;
  }
  
  console.log(`Found ${items.length} existing items`);
  
  let result = sectionHtml;
  const newItemsCount = Math.max(imageUrls.length, textContents.length);
  
  console.log(`Updating first ${newItemsCount} items, keeping remaining ${Math.max(0, items.length - newItemsCount)} items intact`);
  
  // Replace only the first N items (where N = number of new items)
  for (let i = 0; i < Math.min(items.length, newItemsCount); i++) {
    const oldItem = items[i];
    let newItem = oldItem;
    
    // Replace image
    if (imageUrls[i]) {
      newItem = newItem.replace(
        /<a href="[^"]*">[^<]*<\/a>/,
        `<a href="${imageUrls[i]}">${imageUrls[i]}</a>`
      );
    }
    
    // Replace text (handle both plain text and <strong> wrapped text)
    if (textContents[i]) {
      // Try to replace text after <strong> tag or plain paragraph text
      const strongMatch = newItem.match(/<p><strong>[^<]*<\/strong><\/p>/);
      if (strongMatch) {
        // Has <strong>, replace the text paragraph after it
        newItem = newItem.replace(
          /(<p><strong>[^<]*<\/strong><\/p>\s*<p>)[^<]*(<\/p>)/,
          `$1${textContents[i]}$2`
        );
      } else {
        // Plain paragraph, replace it
        newItem = newItem.replace(
          /(<p>)[^<]*(<\/p>)/,
          `$1${textContents[i]}$2`
        );
      }
    }
    
    console.log(`  Replacing item ${i + 1}/${newItemsCount}`);
    result = result.replace(oldItem, newItem);
  }
  
  // If we need MORE items than exist, add new ones
  if (newItemsCount > items.length) {
    console.log(`Adding ${newItemsCount - items.length} new items`);
    const lastItemIndex = result.lastIndexOf(items[items.length - 1]);
    const afterLastItem = lastItemIndex + items[items.length - 1].length;
    
    let newItems = '';
    for (let i = items.length; i < newItemsCount; i++) {
      newItems += '<div><div>';
      if (imageUrls[i]) {
        newItems += `<p><a href="${imageUrls[i]}">${imageUrls[i]}</a></p>`;
      }
      newItems += '</div><div>';
      if (textContents[i]) {
        newItems += `<p>${textContents[i]}</p>`;
      }
      newItems += '</div></div>';
    }
    
    result = result.substring(0, afterLastItem) + newItems + result.substring(afterLastItem);
  }
  
  console.log(`✅ Updated first ${newItemsCount} items, kept ${Math.max(0, items.length - newItemsCount)} items unchanged`);
  return result;
}

/**
 * Update simple paragraphs (non-block sections)
 * Simple find and replace approach
 */
function updateSimpleParagraphs(sectionHtml, imageUrls, textContents) {
  console.log('📝 Updating simple paragraphs');
  
  let result = sectionHtml;
  
  // Replace image links
  if (imageUrls.length > 0 && imageUrls[0]) {
    result = result.replace(
      /<a href="[^"]*">[^<]*<\/a>/,
      `<a href="${imageUrls[0]}">${imageUrls[0]}</a>`
    );
    console.log('✅ Replaced image');
  }
  
  // Replace or add text paragraphs
  for (let i = 0; i < textContents.length; i++) {
    if (!textContents[i]) continue;
    
    // Find text paragraphs (not containing <a> tags)
    const textParaPattern = /<p>(?!<a|<strong)([^<][\s\S]*?)<\/p>/g;
    const textParas = result.match(textParaPattern);
    
    if (textParas && textParas[i]) {
      // Replace existing paragraph
      result = result.replace(textParas[i], `<p>${textContents[i]}</p>`);
    } else {
      // Add new paragraph before closing div
      result = result.replace(/<\/div>$/, `<p>${textContents[i]}</p></div>`);
    }
  }
  
  console.log('✅ Updated paragraphs');
  return result;
}

// Old complex functions removed - now using simple find-and-replace approach above

/**
 * Convert base64 string to Blob
 * No CORS issues since data is already in memory
 */
function base64ToBlob(base64, contentType = 'image/png') {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: contentType });
}

/**
 * Retry wrapper with exponential backoff for handling intermittent network errors
 * Handles SSL/TLS errors, connection resets, and other transient failures
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} initialDelay - Initial delay in ms (default: 1000)
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if it's a retryable error
      const isRetryable = 
        error.message.includes('Failed to fetch') ||
        error.message.includes('SSL') ||
        error.message.includes('TLS') ||
        error.message.includes('ERR_SSL_BAD_RECORD_MAC_ALERT') ||
        error.message.includes('Network') ||
        error.message.includes('ECONNRESET');
      
      // If not retryable or last attempt, throw
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      // Calculate exponential backoff delay
      const delay = initialDelay * Math.pow(2, attempt);
      console.log(`⚠️ Attempt ${attempt + 1} failed (${error.message}). Retrying in ${delay}ms...`);
      
      await new Promise(r => setTimeout(r, delay));
    }
  }
  
  throw lastError;
}

/**
 * Upload image to DA assets/assets-cu folder and get EDS URL
 * Follows the same flow as Power Automate workflow
 * @param {string} base64Image - Base64 encoded image data from DALL-E
 * @param {string} filename - Filename for the asset
 * @param {string} daToken - DA authentication token
 */
async function uploadImageToDA(base64Image, filename, daToken) {
  console.log(`📤 Uploading image to DA assets-cu: ${filename}`);
  
  try {
    // Step 1: Convert base64 to Blob (no CORS issues!)
    console.log(`Converting base64 to blob...`);
    const imageBlob = base64ToBlob(base64Image, 'image/png');
    console.log(`✅ Image converted to blob (${imageBlob.size} bytes)`);
    
    // Step 2: Upload to DA assets/assets-cu folder (WITH RETRY)
    // Path: assets/assets-cu/{filename}
    const assetPath = `assets/assets-cu/${filename}`;
    const uploadUrl = `https://admin.da.live/source/${ORG}/${REPO}/${assetPath}`;
    
    console.log(`Uploading to DA: ${uploadUrl}`);
    
    await retryWithBackoff(async () => {
      const formData = new FormData();
      formData.append('data', imageBlob, filename);
      
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${daToken}`
        },
        body: formData
      });
      
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('DA upload failed:', uploadResponse.status, errorText);
        throw new Error(`DA upload failed: ${uploadResponse.status}`);
      }
      
      console.log(`✅ Image uploaded to DA at: ${assetPath}`);
    }, 3, 1000); // 3 retries, starting with 1s delay
    
    // Step 3: EDS Preview - Make asset available on preview (WITH RETRY)
    const previewUrl = `https://admin.hlx.page/preview/${ORG}/${REPO}/main/${assetPath}`;
    console.log(`Triggering EDS preview: ${previewUrl}`);
    
    await retryWithBackoff(async () => {
      const previewResponse = await fetch(previewUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${daToken}`
        }
      });
      
      if (!previewResponse.ok) {
        console.warn('Preview trigger failed:', previewResponse.status);
        // Don't throw - preview is optional
      } else {
        console.log(`✅ EDS preview triggered`);
      }
    }, 2, 500); // 2 retries, starting with 500ms delay
    
    // Wait for preview to process
    await new Promise(r => setTimeout(r, 1000));
    
    // Step 4: EDS Publish - Make asset live on CDN (WITH RETRY)
    const publishUrl = `https://admin.hlx.page/live/${ORG}/${REPO}/main/${assetPath}`;
    console.log(`Publishing to EDS: ${publishUrl}`);
    
    await retryWithBackoff(async () => {
      const publishResponse = await fetch(publishUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${daToken}`
        }
      });
      
      if (!publishResponse.ok) {
        console.warn('Publish trigger failed:', publishResponse.status);
        // Don't throw - we can still return the URL
      } else {
        const publishResult = await publishResponse.json();
        console.log(`✅ EDS publish triggered:`, publishResult);
      }
    }, 2, 500); // 2 retries, starting with 500ms delay
    
    // Wait for publish to complete
    await new Promise(r => setTimeout(r, 800));
    
    // Step 5: Return the EDS live URL (CDN URL)
    const edsUrl = `https://main--${REPO}--${ORG}.aem.page/${assetPath}`;
    console.log(`✅ Asset available at: ${edsUrl}`);
    
    return edsUrl;
    
  } catch (error) {
    console.error('Image upload/publish failed:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    // Provide more specific error messages
    if (error.message.includes('Failed to fetch') || error.message.includes('SSL') || error.message.includes('TLS')) {
      throw new Error(`Network error uploading to DA after multiple retries. This could be:\n- SSL/TLS issue (ERR_SSL_BAD_RECORD_MAC_ALERT)\n- Network connectivity problem\n- DA API rate limiting\n- Server connection limit\nOriginal error: ${error.message}\n\nTry again in a few moments.`);
    }
    
    throw new Error(`Failed to upload image to DA: ${error.message}`);
  }
}

/**
 * Fetches and parses the ai-config.txt file to get AI credentials
 */
async function getAIConfig() {
  if (cachedAIConfig) {
    return cachedAIConfig;
  }

  try {
    const response = await fetch('/ai-config.txt');
    if (!response.ok) {
      console.warn('Could not fetch ai-config.txt file:', response.status);
      return null;
    }

    const configContent = await response.text();
    const config = {};
    
    const lines = configContent.split('\n');
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('#') || trimmedLine === '') continue;
      
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0) {
        let value = valueParts.join('=').trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        config[key.trim()] = value;
      }
    }

    if (!config.OPENAI_TOKEN) {
      console.warn('Missing required OpenAI API token');
      return null;
    }

    cachedAIConfig = config;
    console.log('✅ AI Config loaded (OpenAI)');
    return cachedAIConfig;
    
  } catch (error) {
    console.error('Error reading ai-config.txt:', error);
    return null;
  }
}

/**
 * Fetches and parses the da-config.txt file to get DA_IMS_TOKEN
 */
async function getDATokenFromConfig() {
  if (cachedDAToken) {
    return cachedDAToken;
  }

  try {
    const response = await fetch('/da-config.txt');
    if (!response.ok) {
      console.warn('Could not fetch da-config.txt file:', response.status);
      return null;
    }

    const envContent = await response.text();
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('#') || trimmedLine === '') continue;
      
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key.trim() === 'DA_IMS_TOKEN') {
        cachedDAToken = valueParts.join('=').trim();
        if ((cachedDAToken.startsWith('"') && cachedDAToken.endsWith('"')) ||
            (cachedDAToken.startsWith("'") && cachedDAToken.endsWith("'"))) {
          cachedDAToken = cachedDAToken.slice(1, -1);
        }
        console.log('✅ DA IMS Token loaded');
        return cachedDAToken;
      }
    }

    console.warn('DA_IMS_TOKEN not found in da-config.txt');
    return null;
  } catch (error) {
    console.error('Error reading da-config.txt:', error);
    return null;
  }
}

/**
 * Get current HTML from DA
 */
async function getCurrentHTML(token) {
  const url = `https://admin.da.live/source/${ORG}/${REPO}/${HTML_FILE}.html`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch HTML: ${response.status}`);
  }
  
  return await response.text();
}

/**
 * Find content by heading
 */
function findContentByHeading(html, headingText) {
  const headingPatterns = [
    { tag: 'h1', regex: new RegExp(`<h1>([^<]*${headingText}[^<]*)<\\/h1>`, 'i') },
    { tag: 'h2', regex: new RegExp(`<h2>([^<]*${headingText}[^<]*)<\\/h2>`, 'i') },
    { tag: 'h3', regex: new RegExp(`<h3>([^<]*${headingText}[^<]*)<\\/h3>`, 'i') }
  ];
  
  for (const pattern of headingPatterns) {
    const match = html.match(pattern.regex);
    if (match) {
      const headingIndex = match.index;
      const fullHeadingTag = match[0];
      const headingText = match[1];
      
      const afterHeading = html.substring(headingIndex + fullHeadingTag.length);
      const nextHeadingMatch = afterHeading.match(/<h[123]>/);
      const nextDivCloseMatch = afterHeading.match(/<\/div><div>/);
      
      let contentEnd = afterHeading.length;
      if (nextHeadingMatch && nextDivCloseMatch) {
        contentEnd = Math.min(nextHeadingMatch.index, nextDivCloseMatch.index);
      } else if (nextHeadingMatch) {
        contentEnd = nextHeadingMatch.index;
      } else if (nextDivCloseMatch) {
        contentEnd = nextDivCloseMatch.index;
      }
      
      const contentAfterHeading = afterHeading.substring(0, contentEnd);
      
      return {
        headingType: pattern.tag,
        headingText: headingText,
        fullHeadingTag: fullHeadingTag,
        content: fullHeadingTag + contentAfterHeading,
        startIndex: headingIndex,
        endIndex: headingIndex + fullHeadingTag.length + contentEnd
      };
    }
  }
  
  return null;
}

/**
 * Update images in content
 */
function updateContentImages(content, newImages) {
  let updated = content;
  const imgRegex = /<a href="([^"]*\/assets\/[^"]+)">([^<]*)<\/a>/g;
  const currentImages = [];
  let match;
  
  while ((match = imgRegex.exec(content)) !== null) {
    currentImages.push({
      url: match[1],
      linkText: match[2],
      fullMatch: match[0]
    });
  }
  
  newImages.forEach((newImg, index) => {
    if (currentImages[index]) {
      const oldImg = currentImages[index];
      const newLink = `<a href="${newImg.url}">${newImg.url}</a>`;
      updated = updated.replace(oldImg.fullMatch, newLink);
    }
  });
  
  return updated;
}

/**
 * Update heading
 */
function updateContentHeading(content, newHeading, headingType) {
  const headingRegex = new RegExp(`<${headingType}>([^<]+)<\/${headingType}>`);
  const match = content.match(headingRegex);
  
  if (match) {
    const oldHeading = match[1];
    return content.replace(
      `<${headingType}>${oldHeading}</${headingType}>`,
      `<${headingType}>${newHeading}</${headingType}>`
    );
  }
  
  return content;
}

/**
 * Update text paragraphs
 */
function updateContentTexts(content, newTexts) {
  let updated = content;
  const textParagraphs = [];
  const pRegex = /<p>(?!<a)([^<]+)<\/p>/g;
  let match;
  
  while ((match = pRegex.exec(content)) !== null) {
    textParagraphs.push({
      text: match[1],
      fullMatch: match[0]
    });
  }
  
  newTexts.forEach((newText, index) => {
    if (textParagraphs[index]) {
      const oldP = textParagraphs[index];
      updated = updated.replace(oldP.fullMatch, `<p>${newText}</p>`);
    }
  });
  
  return updated;
}

/**
 * Upload HTML to DA (with retry logic)
 */
async function uploadHTML(token, htmlContent) {
  const url = `https://admin.da.live/source/${ORG}/${REPO}/${HTML_FILE}.html`;
  
  return await retryWithBackoff(async () => {
    const formData = new FormData();
    const blob = new Blob([htmlContent], { type: 'text/html' });
    formData.append('data', blob, `${HTML_FILE}.html`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
    
    return await response.json();
  }, 3, 1000); // 3 retries, starting with 1s delay
}

/**
 * Trigger preview and publish (with retry logic)
 */
async function triggerPreviewAndPublish(token) {
  // Trigger preview with retry
  await retryWithBackoff(async () => {
    const response = await fetch(`https://admin.hlx.page/preview/${ORG}/${REPO}/main/${HTML_FILE}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
      console.warn('Preview trigger failed:', response.status);
      // Don't throw - preview is optional
    }
  }, 2, 500); // 2 retries, starting with 500ms delay
  
  await new Promise(r => setTimeout(r, 1500)); // Increased delay
  
  // Trigger publish with retry
  await retryWithBackoff(async () => {
    const response = await fetch(`https://admin.hlx.page/live/${ORG}/${REPO}/main/${HTML_FILE}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
      console.warn('Publish trigger failed:', response.status);
      // Don't throw - we can still proceed
    }
  }, 2, 500); // 2 retries, starting with 500ms delay
}

/**
 * Main update function
 */
async function updateDAContent(targetHeading, updates, statusCallback) {
  const token = await getDATokenFromConfig();
  if (!token) {
    throw new Error('Cannot proceed without DA_IMS_TOKEN');
  }
  
  statusCallback('📥 Fetching current HTML...');
  const html = await getCurrentHTML(token);
  
  statusCallback('🔍 Finding target section...');
  const targetContent = findContentByHeading(html, targetHeading);
  
  if (!targetContent) {
    throw new Error(`Heading "${targetHeading}" not found`);
  }
  
  statusCallback('✏️  Updating content...');
  let updatedContent = targetContent.content;
  
  if (updates.heading) {
    updatedContent = updateContentHeading(updatedContent, updates.heading, targetContent.headingType);
  }
  
  if (updates.images && updates.images.length > 0) {
    updatedContent = updateContentImages(updatedContent, updates.images);
  }
  
  if (updates.texts && updates.texts.length > 0) {
    updatedContent = updateContentTexts(updatedContent, updates.texts);
  }
  
  statusCallback('🔄 Replacing in HTML...');
  const updatedHTML = html.substring(0, targetContent.startIndex) +
                      updatedContent +
                      html.substring(targetContent.endIndex);
  
  statusCallback('📤 Uploading to DA...');
  const result = await uploadHTML(token, updatedHTML);
  
  statusCallback('🚀 Publishing...');
  await new Promise(r => setTimeout(r, 2000));
  await triggerPreviewAndPublish(token);
  
  return result;
}

export default function decorate(block) {
  const chatbotHTML = `
    <div class="sidebar-chat" id="sidebarChat">
      <div class="header">
        <div class="header-content">
          <img class="adobe-logo" src="../../adobe-logo.png" alt="Adobe Logo" width="20" height="20">
          Content Updater
        </div>
        <span class="close-btn">✖</span>
      </div>
      <div class="messages">
        <div class="bot-msg">
          🤖 Hi! I'm your AI-Powered & Voice-Enabled Content Updater.<br><br>
          <strong>Enable me with AI tokens to:</strong><br>
          ✨ Understand your intent (type or speak)<br>
          🎯 Analyze page structure<br>
          🎨 Generate custom images<br>
          📝 Write engaging content<br>
          🚀 Update & publish instantly<br><br>
          <strong>Just tell me what you want:</strong><br>
          • "Update hero block with New York skyline"<br>
          • "Update columns block with something about Paris and Zurich"<br>
          • "Change cards block to show sports - Cricket / Football"<br>
          • Or anything else - I'm smart! 😊<br><br>
          🎤 <em>Tip: Click the mic button to use voice input!</em>
        </div>
      </div>
      <div class="input-container">
        <input type="text" placeholder="Type or speak..." class="chat-input">
        <button class="mic-btn" title="Click to speak">
          <svg class="mic-icon" width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path fill="#aaaaaa" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path fill="#aaaaaa" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
          <div class="mic-pulse"></div>
        </button>
      </div>
    </div>
    <button class="open-btn">How may I help you ?</button>
  `;
  
  block.innerHTML = chatbotHTML;
  
  const openBtn = block.querySelector('.open-btn');
  const closeBtn = block.querySelector('.close-btn');
  const chatInput = block.querySelector('.chat-input');
  const micBtn = block.querySelector('.mic-btn');
  
  openBtn.addEventListener('click', openSidebar);
  closeBtn.addEventListener('click', closeSidebar);
  chatInput.addEventListener('keypress', handleSend);
  
  // Initialize speech recognition
  initSpeechRecognition();
  
  // Add mic button click handler
  micBtn.addEventListener('click', () => toggleSpeechRecognition(chatInput, micBtn));
}

function openSidebar() {
  const sidebar = document.getElementById('sidebarChat');
  sidebar.style.right = '0';
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebarChat');
  sidebar.style.right = '-350px';
  
  // Stop speech recognition if active when closing sidebar
  if (isListening && recognition) {
    recognition.stop();
    isListening = false;
  }
}

function initSpeechRecognition() {
  // Check for browser support
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.warn('Speech Recognition not supported in this browser');
    return null;
  }
  
  recognition = new SpeechRecognition();
  recognition.continuous = true; // Keep listening until manually stopped or timeout
  recognition.interimResults = true; // Show results as user speaks
  recognition.lang = 'en-US';
  
  return recognition;
}

function toggleSpeechRecognition(inputElement, micButton) {
  if (!recognition) {
    // Browser doesn't support speech recognition
    showSpeechError(inputElement, 'Speech recognition is not supported in your browser. Please use Chrome or Edge.');
    return;
  }
  
  if (isListening) {
    // Stop listening and send immediately if there's content
    clearTimeout(speechTimeout);
    recognition.stop();
    isListening = false;
    micButton.classList.remove('listening');
    inputElement.placeholder = 'Type or speak...';
    
    // Send accumulated transcript if any
    if (accumulatedTranscript.trim()) {
      sendVoiceMessage(accumulatedTranscript.trim(), inputElement);
    }
    accumulatedTranscript = '';
  } else {
    // Start listening
    isListening = true;
    accumulatedTranscript = '';
    micButton.classList.add('listening');
    inputElement.placeholder = 'Listening... (3s silence to send)';
    inputElement.value = '';
    
    // Function to reset the 3-second timer
    const resetSpeechTimeout = () => {
      clearTimeout(speechTimeout);
      speechTimeout = setTimeout(() => {
        // 3 seconds of silence - stop and send
        if (isListening && accumulatedTranscript.trim()) {
          recognition.stop();
          isListening = false;
          micButton.classList.remove('listening');
          inputElement.placeholder = 'Type or speak...';
          sendVoiceMessage(accumulatedTranscript.trim(), inputElement);
          accumulatedTranscript = '';
        }
      }, SPEECH_DELAY_MS);
    };
    
    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      
      // Accumulate final transcripts
      if (finalTranscript) {
        accumulatedTranscript += finalTranscript + ' ';
      }
      
      // Show current state in the input field
      inputElement.value = (accumulatedTranscript + interimTranscript).trim();
      
      // Reset the 3-second timer on any speech activity
      resetSpeechTimeout();
    };
    
    // Start the initial timeout
    resetSpeechTimeout();
    
    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      clearTimeout(speechTimeout);
      
      // Don't treat 'no-speech' as an error when we have accumulated text
      if (event.error === 'no-speech' && accumulatedTranscript.trim()) {
        // Just restart recognition to keep listening
        return;
      }
      
      isListening = false;
      micButton.classList.remove('listening');
      inputElement.placeholder = 'Type or speak...';
      
      let errorMessage = 'Speech recognition error. Please try again.';
      if (event.error === 'no-speech') {
        errorMessage = 'No speech detected. Please try again.';
      } else if (event.error === 'audio-capture') {
        errorMessage = 'No microphone found. Please check your microphone.';
      } else if (event.error === 'not-allowed') {
        errorMessage = 'Microphone access denied. Please allow microphone access.';
      }
      
      accumulatedTranscript = '';
      showSpeechError(inputElement, errorMessage);
    };
    
    recognition.onend = () => {
      // If we're still supposed to be listening, restart recognition
      // (continuous recognition can end unexpectedly)
      if (isListening) {
        try {
          recognition.start();
        } catch (e) {
          // Recognition already started or other error - just reset
          isListening = false;
          micButton.classList.remove('listening');
          inputElement.placeholder = 'Type or speak...';
          clearTimeout(speechTimeout);
        }
      }
    };
    
    try {
      recognition.start();
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
      isListening = false;
      micButton.classList.remove('listening');
      showSpeechError(inputElement, 'Failed to start speech recognition. Please try again.');
    }
  }
}

function showSpeechError(inputElement, message) {
  const msgContainer = document.querySelector('.sidebar-chat .messages');
  const errorMsg = document.createElement('div');
  errorMsg.className = 'bot-msg error';
  errorMsg.innerHTML = `<span class="error-text">🎤 ${message}</span>`;
  msgContainer.appendChild(errorMsg);
  msgContainer.scrollTop = msgContainer.scrollHeight;
  inputElement.placeholder = 'Type or speak...';
}

function sendVoiceMessage(userInput, inputElement) {
  const msgContainer = document.querySelector('.sidebar-chat .messages');
  
  // Add user message with voice indicator
  const userMsg = document.createElement('div');
  userMsg.className = 'user-msg';
  userMsg.innerHTML = `<span class="voice-indicator">🎤</span> ${userInput}`;
  msgContainer.appendChild(userMsg);
  
  // Clear input and scroll
  inputElement.value = '';
  msgContainer.scrollTop = msgContainer.scrollHeight;
  
  // Process the message
  processMessage(userInput, msgContainer);
}

async function handleSend(e) {
  if (e.key === 'Enter' && e.target.value.trim() !== '') {
    const msgContainer = document.querySelector('.sidebar-chat .messages');
    const userInput = e.target.value.trim();
    
    // Add user message
    const userMsg = document.createElement('div');
    userMsg.className = 'user-msg';
    userMsg.textContent = userInput;
    msgContainer.appendChild(userMsg);
    
    e.target.value = '';
    msgContainer.scrollTop = msgContainer.scrollHeight;
    
    // Process the message
    await processMessage(userInput, msgContainer);
  }
}

async function processMessage(userInput, msgContainer) {
  const botMsg = document.createElement('div');
  botMsg.className = 'bot-msg loading';
  botMsg.innerHTML = `
    <div class="loading-indicator">
      <span class="spinner"></span>
      🤖 AI is analyzing your request...
    </div>
    <div class="progress-steps" id="progress-steps"></div>
  `;
  msgContainer.appendChild(botMsg);
  msgContainer.scrollTop = msgContainer.scrollHeight;
  
  const progressSteps = botMsg.querySelector('#progress-steps');
  
  const addStep = (icon, text, isActive = true) => {
    const stepItem = document.createElement('div');
    stepItem.className = isActive ? 'step-item active' : 'step-item completed';
    stepItem.innerHTML = `<span class="step-icon">${icon}</span><span class="step-text">${text}</span>`;
    progressSteps.appendChild(stepItem);
    msgContainer.scrollTop = msgContainer.scrollHeight;
    
    // Mark previous step as completed
    const steps = progressSteps.querySelectorAll('.step-item');
    if (steps.length > 1) {
      steps[steps.length - 2].className = 'step-item completed';
      steps[steps.length - 2].querySelector('.step-icon').textContent = '✅';
    }
    
    return stepItem;
  };
  
  try {
    // Check for AI configuration
    const aiConfig = await getAIConfig();
    if (!aiConfig) {
      throw new Error('AI configuration not found. Please create ai-config.txt with OPENAI_TOKEN');
    }
    
    // Get DA token
    const daToken = await getDATokenFromConfig();
    if (!daToken) {
      throw new Error('DA_IMS_TOKEN not found in da-config.txt');
    }
    
    // Step 1: Fetch HTML and analyze structure
    addStep('📥', 'Fetching page structure...');
    const html = await getCurrentHTML(daToken);
    const structure = extractPageStructure(html);
    
    // Step 2: Ask AI to analyze and create transformation plan
    addStep('🤖', 'AI analyzing and planning transformation...');
    const aiPlan = await askAIToGeneratePlan(userInput, html, structure);
    
    console.log('AI Plan Result:', aiPlan);
    
    // Step 3: Generate images with DALL-E based on AI's descriptions (if needed)
    const itemsWithImages = aiPlan.items?.filter(item => item.imageDescription && item.imageDescription.trim()) || [];
    const imageCount = itemsWithImages.length;
    
    if (imageCount > 0) {
      addStep('🎨', `Generating ${imageCount} AI image(s)...`);
    }
    
    const imageUrls = [];
    const textContents = [];
    
    for (let i = 0; i < aiPlan.items?.length || 0; i++) {
      const item = aiPlan.items[i];
      
      // Only generate image if imageDescription is provided
      if (item.imageDescription && item.imageDescription.trim()) {
        // Generate image with DALL-E (returns base64)
        const base64Image = await generateImageWithDALLE(item.imageDescription);
        
        // Mark DALL-E generation as complete
        const steps = progressSteps.querySelectorAll('.step-item');
        if (steps.length > 0) {
          steps[steps.length - 1].className = 'step-item completed';
          steps[steps.length - 1].querySelector('.step-icon').textContent = '✅';
        }
        
        // Step 4: Upload to DA and publish
        addStep('📤', `Uploading image ${i + 1}/${imageCount} to DA assets-cu...`);
        
        // Add delay between images to avoid SSL/TLS connection issues
        if (i > 0) {
          console.log(`⏳ Waiting 2s before next upload to avoid SSL errors...`);
          await new Promise(r => setTimeout(r, 2000)); // Increased from 500ms
        }
        
        const filename = `ai-gen-${Date.now()}-${i}.png`;
        const edsUrl = await uploadImageToDA(base64Image, filename, daToken);
        
        imageUrls.push(edsUrl);
        
        // Add delay after upload/publish to let DA/EDS fully process
        console.log(`⏳ Waiting for DA/EDS to process...`);
        await new Promise(r => setTimeout(r, 1500)); // Increased from 1000ms
      } else {
        // Text-only update, no image needed
        console.log(`Item ${i + 1}: Text-only update (no image)`);
        imageUrls.push(null); // Placeholder for no image
      }
      
      textContents.push(item.textContent);
    }
    
    // Step 5: Apply AI's transformation plan (no eval needed!)
    addStep('⚙️', 'Applying AI transformation plan...');
    
    console.log('AI Plan:', JSON.stringify(aiPlan, null, 2));
    
    let updatedHTML = html;
    
    // Apply transformation based on AI's action plan
    if (aiPlan.action === 'update_hero') {
      updatedHTML = updateHeroSection(
        updatedHTML,
        aiPlan.targetHeading,
        aiPlan.newHeading,
        imageUrls,
        textContents,
        aiPlan.replaceAll !== false, // Default to true if not specified
        aiPlan.targetPosition || null
      );
    } else if (aiPlan.action === 'update_section' || aiPlan.action === 'update_columns') {
      updatedHTML = updateSectionByHeading(
        updatedHTML,
        aiPlan.targetHeading,
        aiPlan.newHeading,
        imageUrls,
        textContents,
        aiPlan.replaceAll !== false, // Default to true if not specified
        aiPlan.targetPosition || null
      );
    } else {
      throw new Error(`Unknown action: ${aiPlan.action}`);
    }
    
    // Step 6: Upload to DA
    addStep('📤', 'Uploading to DA...');
    const result = await uploadHTML(daToken, updatedHTML);
    
    // Step 7: Publish
    addStep('🚀', 'Publishing changes...');
    await new Promise(r => setTimeout(r, 2000));
    await triggerPreviewAndPublish(daToken);
    
    // Mark last step as completed
    const steps = progressSteps.querySelectorAll('.step-item');
    if (steps.length > 0) {
      steps[steps.length - 1].className = 'step-item completed';
      steps[steps.length - 1].querySelector('.step-icon').textContent = '✅';
    }
    
    // Success message with details
    botMsg.className = 'bot-msg success';
    botMsg.innerHTML = `
      <div class="success-message">
        ✅ <strong>AI-Powered Update Complete!</strong><br><br>
        <div class="update-preview">
          <h4>🎯 What AI Decided:</h4>
          <div class="item"><span class="label">Target Section:</span> ${aiPlan.targetHeading || 'Hero'}</div>
          <div class="item"><span class="label">New Heading:</span> ${aiPlan.newHeading || 'Updated'}</div>
          <div class="item"><span class="label">Action:</span> ${aiPlan.action}</div>
          <div class="item"><span class="label">Images Generated:</span> ${imageUrls.filter(url => url).length} (DALL-E 3)</div>
          <div class="item"><span class="label">AI Engine:</span> OpenAI GPT-4</div>
        </div>
        <br>
        🌐 <a href="${result.aem?.previewUrl}" target="_blank" class="da-url">View Preview</a><br>
        📝 <a href="https://da.live/edit#/${ORG}/${REPO}/${HTML_FILE}" target="_blank" class="da-url">Edit in DA</a><br>
        <br>
        <details style="font-size: 0.85em; opacity: 0.8; margin-top: 8px;">
          <summary style="cursor: pointer;">📋 View AI Transformation Plan</summary>
          <pre style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 0.75em; margin-top: 8px;">${JSON.stringify(aiPlan, null, 2)}</pre>
        </details>
        <br>
        <span style="font-size: 0.85em; opacity: 0.8;">✨ Powered by OpenAI GPT-4 (Planning) + DALL-E 3 (Images)</span>
      </div>
    `;
    
  } catch (error) {
    console.error('AI-powered update failed:', error);
    botMsg.className = 'bot-msg error';
    botMsg.innerHTML = `
      <div class="error-message">
        ❌ <strong>AI Update Failed</strong><br>
        <span class="error-text">${error.message}</span><br>
        <span class="retry-text">Please try again. Make sure your OpenAI API key is configured.</span>
      </div>
    `;
  }
  
  msgContainer.scrollTop = msgContainer.scrollHeight;
}

// Note: No need for parseUserInput anymore - AI handles all parsing and planning!

/* ============================================================================
 * POWER AUTOMATE INTEGRATION (ALTERNATIVE APPROACH)
 * ============================================================================
 * 
 * WHEN TO USE POWER AUTOMATE vs DIRECT OPENAI:
 * 
 * 📊 DIRECT OPENAI (Current Default):
 * ✅ Faster - No intermediate workflow overhead
 * ✅ Simpler - Less configuration required
 * ✅ Real-time - Direct API calls from browser
 * ❌ Exposed API keys (stored in ai-config.txt on client)
 * ❌ Limited to OpenAI features only
 * ❌ No approval workflows or additional logic
 * 
 * 🔄 POWER AUTOMATE:
 * ✅ Secure - API keys stay in Power Automate (server-side)
 * ✅ Flexible - Add approvals, notifications, Teams integration
 * ✅ Auditable - Full logging and monitoring in Power Platform
 * ✅ Extensible - Connect to 400+ Microsoft connectors
 * ✅ Enterprise-ready - Compliance, governance, DLP policies
 * ❌ Slower - Additional network hop through workflow
 * ❌ Complex - Requires Power Automate license and setup
 * 
 * ============================================================================
 * SETUP STEPS FOR POWER AUTOMATE:
 * ============================================================================
 * 
 * 1️⃣ CREATE POWER AUTOMATE FLOW:
 *    - Go to https://make.powerautomate.com
 *    - Create new "Instant cloud flow"
 *    - Add trigger: "When an HTTP request is received"
 * 
 * 2️⃣ ADD FLOW ACTIONS:
 *    a) Parse JSON (parse incoming request body)
 *    b) OpenAI GPT-4 connector (analyze request)
 *    c) OpenAI DALL-E connector (generate images)
 *    d) HTTP action (upload to DA API)
 *    e) HTTP action (trigger EDS preview)
 *    f) HTTP action (trigger EDS publish)
 *    g) Response (return success/error)
 * 
 * 3️⃣ CONFIGURE THIS FILE:
 *    - Copy webhook URL from step 1
 *    - Set POWER_AUTOMATE_URL below
 *    - Set INTEGRATION_MODE = 'POWER_AUTOMATE' at the top
 *    - Uncomment the triggerPowerAutomateFlow function
 * 
 * 4️⃣ UPDATE processMessage() FUNCTION:
 *    Replace the AI calls with:
 *    if (INTEGRATION_MODE === 'POWER_AUTOMATE') {
 *      await triggerPowerAutomateFlow(userInput, botMsg);
 *    } else {
 *      // existing direct OpenAI calls
 *    }
 * 
 * ============================================================================
 * BEST PRACTICES:
 * ============================================================================
 * 
 * 🔒 Security:
 *    - Store OpenAI keys in Power Automate connections (encrypted)
 *    - Use managed identities for Azure resources
 *    - Enable DLP policies to prevent data leakage
 * 
 * ⚡ Performance:
 *    - Add timeout handling (flows can take 5-10 seconds)
 *    - Implement retry logic for transient failures
 *    - Consider async processing for large operations
 * 
 * 📝 Monitoring:
 *    - Enable run history in Power Automate
 *    - Set up alerts for failed runs
 *    - Track API usage and costs
 * 
 * 🧪 Testing:
 *    - Test with sample requests before enabling
 *    - Verify error handling for all scenarios
 *    - Check timeout behavior
 * 
 * ============================================================================
 */

/*
// Power Automate Configuration
const POWER_AUTOMATE_URL = 'YOUR_POWER_AUTOMATE_WEBHOOK_URL_HERE';

async function triggerPowerAutomateFlow(userPrompt, botMessageElement) {
  console.log('🔄 Triggering Power Automate flow...');
  
  // Get configuration tokens
  const daImsToken = await getDATokenFromConfig();
  const adminAuthToken = await getAdminAuthTokenFromConfig();
  
  if (!daImsToken || !adminAuthToken) {
    botMessageElement.className = 'bot-msg error';
    botMessageElement.innerHTML = `
      <div class="error-message">
        ⚠️ <strong>Configuration Required</strong><br>
        <span class="error-text">Please configure DA_IMS_TOKEN and ADMIN_AUTH_TOKEN in da-config.txt</span>
      </div>
    `;
    return;
  }
  
  // Prepare request body for Power Automate
  const requestBody = {
    prompt: userPrompt,
    timestamp: new Date().toISOString(),
    source: 'web-chatbot',
    org: ORG,
    repo: REPO,
    htmlFile: HTML_FILE,
    currentPath: window.location.pathname,
    currentHost: window.location.host,
    fullUrl: window.location.href,
    daImsToken: daImsToken,
    adminAuthToken: adminAuthToken
  };
  
  try {
    // Call Power Automate webhook
    const response = await fetch(POWER_AUTOMATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      throw new Error(`Power Automate returned ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ Power Automate flow completed:', result);
    
    // Update bot message with success
    botMessageElement.className = 'bot-msg success';
    botMessageElement.innerHTML = `
      <div class="success-message">
        ✅ <strong>Content Updated Successfully!</strong><br>
        <span class="prompt-text">Request: "${userPrompt}"</span><br>
        <span class="status-text">Power Automate has processed your request</span><br>
        ${result.imageUrl ? `<img src="${result.imageUrl}" alt="Generated" class="generated-image"><br>` : ''}
        🌐 <a href="${result.previewUrl || '#'}" target="_blank" class="da-url">View Preview</a>
      </div>
    `;
    
  } catch (error) {
    console.error('Power Automate flow failed:', error);
    botMessageElement.className = 'bot-msg error';
    botMessageElement.innerHTML = `
      <div class="error-message">
        ❌ <strong>Power Automate Error</strong><br>
        <span class="error-text">${error.message}</span><br>
        <span class="retry-text">Please check your Power Automate flow and try again.</span>
      </div>
    `;
  }
}

// TO USE POWER AUTOMATE: Replace the processMessage() AI calls with:
// await triggerPowerAutomateFlow(userInput, botMsg);
*/
