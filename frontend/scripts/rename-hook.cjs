const fs = require('fs');
const path = require('path');

const directory = path.join(__dirname, '../src');

function walkDir(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walkDir(fullPath));
    } else if (fullPath.match(/\.(js|jsx)$/)) {
      results.push(fullPath);
    }
  });
  return results;
}

const files = walkDir(directory);
let count = 0;
files.forEach((file) => {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('useR2Upload')) {
    content = content.replace(/useR2Upload/g, 'useMediaUpload');
    fs.writeFileSync(file, content, 'utf8');
    count++;
  }
});

console.log(`Updated ${count} files with useMediaUpload`);

const oldPath = path.join(directory, 'shared/hooks/useR2Upload.js');
const newPath = path.join(directory, 'shared/hooks/useMediaUpload.js');
if (fs.existsSync(oldPath)) {
  fs.renameSync(oldPath, newPath);
  console.log('Renamed useR2Upload.js to useMediaUpload.js');
}
