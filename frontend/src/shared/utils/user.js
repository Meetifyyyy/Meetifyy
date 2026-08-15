/**
 * Centralized utility for user object normalization and properties.
 */

/**
 * Extracts and normalizes the user's college/university name from any user object shape.
 * Handles:
 * - user.college = { id: '...', name: 'College Name' }
 * - user.college = 'College Name'
 * - user.university = 'College Name'
 * - user.campus = 'College Name'
 */
export function getCollegeName(user, defaultFallback = 'College') {
  if (!user) return defaultFallback;
  if (typeof user.college === 'object' && user.college?.name) {
    return user.college.name;
  }
  if (typeof user.collegeName === 'string' && user.collegeName.trim()) {
    return user.collegeName.trim();
  }
  if (typeof user.college_name === 'string' && user.college_name.trim()) {
    return user.college_name.trim();
  }
  if (typeof user.college === 'string' && user.college.trim()) {
    return user.college.trim();
  }
  if (typeof user.universityName === 'string' && user.universityName.trim()) {
    return user.universityName.trim();
  }
  if (typeof user.university === 'string' && user.university.trim()) {
    return user.university.trim();
  }
  if (typeof user.campus === 'string' && user.campus.trim()) {
    return user.campus.trim();
  }
  return defaultFallback;
}
