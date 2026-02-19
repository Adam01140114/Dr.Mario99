#!/usr/bin/env node

/**
 * Script to remove all console.log() statements from a file
 * Handles both single-line and multi-line console.log statements
 */

const fs = require('fs');
const path = require('path');

// Check if file path is provided
if (process.argv.length < 3) {
  console.error('Usage: node remove-console-logs.js <file-path>');
  console.error('Example: node remove-console-logs.js FormWiz GUI/generate.js');
  process.exit(1);
}

const filePath = process.argv[2];

// Check if file exists
if (!fs.existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`);
  process.exit(1);
}

// Read the file
let content = fs.readFileSync(filePath, 'utf8');
const originalLength = content.length;
const originalLines = content.split('\n').length;

console.log(`📄 Processing file: ${filePath}`);
console.log(`📊 Original file size: ${originalLength} characters, ${originalLines} lines`);

// Count all console statements before removal (log, error, warn, debug)
const consoleLogPattern = /console\.(log|error|warn|debug)\([^)]*\);?/g;
const matches = content.match(consoleLogPattern);
const countBefore = matches ? matches.length : 0;

console.log(`🔍 Found ${countBefore} console statements (log/error/warn/debug)`);

// Remove all console statements (log, error, warn, debug)
// We need to handle:
// - Single-line: console.log("text");
// - Multi-line: console.log("text",
//              "more text");
// - Nested parentheses: console.log(fn(1, 2));
// - With comments: console.log("text"); // comment

let removedCount = 0;
let result = '';
let i = 0;

while (i < content.length) {
  // Look for "console.log(", "console.error(", "console.warn(", or "console.debug("
  const consoleLogIndex = content.indexOf('console.log(', i);
  const consoleErrorIndex = content.indexOf('console.error(', i);
  const consoleWarnIndex = content.indexOf('console.warn(', i);
  const consoleDebugIndex = content.indexOf('console.debug(', i);
  
  // Find the earliest occurrence
  const indices = [consoleLogIndex, consoleErrorIndex, consoleWarnIndex, consoleDebugIndex]
    .filter(idx => idx !== -1);
  const consoleIndex = indices.length > 0 ? Math.min(...indices) : -1;
  
  if (consoleIndex === -1) {
    // No more console statements, add remaining content
    result += content.substring(i);
    break;
  }
  
  // Determine which console method we found
  let consoleMethod = '';
  let consoleMethodLength = 0;
  if (consoleIndex === consoleLogIndex) {
    consoleMethod = 'console.log(';
    consoleMethodLength = 'console.log('.length;
  } else if (consoleIndex === consoleErrorIndex) {
    consoleMethod = 'console.error(';
    consoleMethodLength = 'console.error('.length;
  } else if (consoleIndex === consoleWarnIndex) {
    consoleMethod = 'console.warn(';
    consoleMethodLength = 'console.warn('.length;
  } else if (consoleIndex === consoleDebugIndex) {
    consoleMethod = 'console.debug(';
    consoleMethodLength = 'console.debug('.length;
  }
  
  // Add content before the console statement
  result += content.substring(i, consoleIndex);
  
  // Find the matching closing parenthesis
  // console.xxx( already has an opening paren, so we start with depth = 1
  let depth = 1;
  let j = consoleIndex + consoleMethodLength;
  
  // Track parentheses to find the matching closing
  while (j < content.length) {
    const char = content[j];
    
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        // Found the closing parenthesis for console statement
        j++; // Skip the closing parenthesis
        
        // Check if there's a semicolon after (skip whitespace)
        if (j < content.length && content[j] === ';') {
          j++; // Skip the semicolon
        }
        
        // Skip any trailing whitespace
        while (j < content.length && (content[j] === ' ' || content[j] === '\t')) {
          j++;
        }
        
        // Skip the console statement
        removedCount++;
        i = j;
        break;
      }
    }
    
    j++;
  }
  
  // If we didn't find a proper closing (malformed), try to find semicolon as fallback
  if (j >= content.length || depth > 0) {
    const semicolonIndex = content.indexOf(';', consoleIndex);
    if (semicolonIndex !== -1) {
      removedCount++;
      i = semicolonIndex + 1;
    } else {
      // Can't find closing or semicolon, skip past this console statement to avoid infinite loop
      i = consoleIndex + consoleMethodLength;
    }
  }
}

content = result;

// Clean up empty lines left by removed console.log statements
// Remove lines that are now empty or only contain whitespace/comments
const lines = content.split('\n');
const cleanedLines = [];
let prevLineWasEmpty = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();
  
  // Skip empty lines, but keep at most one consecutive empty line
  if (trimmed === '') {
    if (!prevLineWasEmpty) {
      cleanedLines.push('');
      prevLineWasEmpty = true;
    }
    // Skip this empty line
  } else {
    cleanedLines.push(line);
    prevLineWasEmpty = false;
  }
}

content = cleanedLines.join('\n');

// Also remove excessive consecutive empty lines (more than 2)
content = content.replace(/\n\s*\n\s*\n\s*\n+/g, '\n\n');

// Write the cleaned content back to the file
fs.writeFileSync(filePath, content, 'utf8');

const finalLength = content.length;
const finalLines = content.split('\n').length;

console.log(`✅ Removed ${removedCount} console statements (log/error/warn/debug)`);
console.log(`📊 Final file size: ${finalLength} characters, ${finalLines} lines`);
console.log(`📉 Reduction: ${originalLength - finalLength} characters, ${originalLines - finalLines} lines`);
console.log(`💾 File saved: ${filePath}`);

