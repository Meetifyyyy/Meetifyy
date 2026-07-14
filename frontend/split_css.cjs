const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src/features/campus/pages/CampusPage.module.css');
const css = fs.readFileSync(cssPath, 'utf8');

const sharedStyles = [];
const activitiesStyles = [];
const campusStyles = [];
const directoryStyles = [];
const groupsStyles = [];

let currentSection = 'shared'; // starts with shared

const lines = css.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  if (line.includes('/* Templates list */')) {
    currentSection = 'activities';
  } else if (line.includes('/* You May Know */')) {
    currentSection = 'campus';
  } else if (line.includes('/* Discover Groups */')) {
    currentSection = 'groups';
  } else if (line.includes('/* Modals & Overlay */')) {
    currentSection = 'shared_modals';
  } else if (line.includes('.directorySearchRow')) {
    currentSection = 'directory';
  } else if (line.includes('/* Creation Modal Form Sizing */')) {
    currentSection = 'groups_form';
  } else if (line.includes('/* Grid Layouts for Dedicated Pages */')) {
    currentSection = 'directory_grid';
  } else if (line.includes('/* Join Group Modal */')) {
    currentSection = 'groups_join';
  }

  if (currentSection === 'shared' || currentSection === 'shared_modals') {
    sharedStyles.push(line);
  } else if (currentSection === 'activities') {
    activitiesStyles.push(line);
  } else if (currentSection === 'campus') {
    campusStyles.push(line);
  } else if (currentSection === 'groups' || currentSection === 'groups_form' || currentSection === 'groups_join') {
    groupsStyles.push(line);
  } else if (currentSection === 'directory' || currentSection === 'directory_grid') {
    directoryStyles.push(line);
  }
}

// Write the files
fs.writeFileSync(path.join(__dirname, 'src/features/campus/pages/CampusShared.module.css'), sharedStyles.join('\n'));
fs.writeFileSync(path.join(__dirname, 'src/features/campus/pages/ActivitiesPage.module.css'), activitiesStyles.join('\n'));
fs.writeFileSync(path.join(__dirname, 'src/features/campus/pages/DirectoryPage.module.css'), directoryStyles.join('\n'));
fs.writeFileSync(path.join(__dirname, 'src/features/campus/pages/GroupsPage.module.css'), groupsStyles.join('\n'));
fs.writeFileSync(path.join(__dirname, 'src/features/campus/pages/CampusPage.module.css'), campusStyles.join('\n'));

console.log('CSS files split successfully.');
