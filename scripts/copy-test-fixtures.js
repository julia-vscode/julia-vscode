/**
 * Cross-platform script to copy test fixtures
 */
const fs = require('fs');
const path = require('path');

// Source and destination paths
const srcDir = path.join(__dirname, '..', 'src', 'test', 'fixtures');
const destDir = path.join(__dirname, '..', 'out', 'test', 'fixtures');

// Create destination dir
fs.mkdirSync(destDir, { recursive: true });

// Copy JSON files
fs.readdirSync(srcDir)
    .filter(f => f.endsWith('.json'))
    .forEach(f => fs.copyFileSync(
        path.join(srcDir, f),
        path.join(destDir, f)
    ));
