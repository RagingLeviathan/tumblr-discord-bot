const fs = require('fs');

// Read and parse JSON files
const file1Data = JSON.parse(fs.readFileSync('followers24-08-2025 15.json'));
const file2Data = JSON.parse(fs.readFileSync('followers24-08-2025 11.json'));

// Extract follower names from each file
const file1Names = file1Data.map(follower => follower.name);
const file2Names = file2Data.map(follower => follower.name);

// Find names missing in the second file
const missingNames = file1Names.filter(name => !file2Names.includes(name));

// Log the missing names
console.log('Names missing in the second file:');
missingNames.forEach(name => {
    console.log(name);
});

// Write missing names to a new JSON file
fs.writeFileSync('missing_names.json', JSON.stringify(missingNames, null, 2));

console.log('Missing names saved to missing_names.json');
