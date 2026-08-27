import { describe, it, expect } from 'vitest';

function validateCollegeEmail(email, selectedCollege) {
  if (!email) return 'College email is required.';
  if (!email.includes('@')) return 'Enter a valid email address.';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return 'Please enter a valid email address.';

  if (!selectedCollege) {
    return 'Please select your college first.';
  }

  const domain = email.split('@')[1]?.toLowerCase().trim() || '';
  if (!domain) return 'Please enter a valid email address.';

  const collegeDisplayName = selectedCollege.shortName || selectedCollege.name;
  const approvedDomains = (selectedCollege.domains || []).map((d) => d.toLowerCase().trim());

  if (approvedDomains.length > 0 && !approvedDomains.includes(domain)) {
    return `Please use your official ${collegeDisplayName} email.`;
  }

  return null;
}

describe('College Email Verification Rules', () => {
  const iitGuwahati = {
    id: 'col-iitg',
    name: 'Indian Institute of Technology Guwahati',
    shortName: 'IIT Guwahati',
    domains: ['iitg.ac.in'],
  };

  const glaWithGmailAllowed = {
    id: 'col-gla',
    name: 'GLA University',
    shortName: 'GLA',
    domains: ['gla.ac.in', 'gmail.com'],
  };

  it('accepts valid official college email for selected institution', () => {
    expect(validateCollegeEmail('student@iitg.ac.in', iitGuwahati)).toBeNull();
    expect(validateCollegeEmail('user.2024@gla.ac.in', glaWithGmailAllowed)).toBeNull();
  });

  it('accepts domains explicitly configured/allowed by admin in the database', () => {
    expect(validateCollegeEmail('sarthaksaini7770@gmail.com', glaWithGmailAllowed)).toBeNull();
  });

  it('requires college to be selected first if missing', () => {
    expect(validateCollegeEmail('student@gmail.com', null)).toBe('Please select your college first.');
  });

  it('directs user to use their official college email when domain does not match approved domains', () => {
    const err = validateCollegeEmail('student@gmail.com', iitGuwahati);
    expect(err).toBe('Please use your official IIT Guwahati email.');
  });

  it('rejects unapproved or fake domains', () => {
    const err = validateCollegeEmail('sarthaksaini7770@iitgn.com', iitGuwahati);
    expect(err).toBe('Please use your official IIT Guwahati email.');
  });

  it('rejects malformed email addresses', () => {
    expect(validateCollegeEmail('', iitGuwahati)).toBe('College email is required.');
    expect(validateCollegeEmail('student', iitGuwahati)).toBe('Enter a valid email address.');
    expect(validateCollegeEmail('student@', iitGuwahati)).toBe('Please enter a valid email address.');
  });
});
