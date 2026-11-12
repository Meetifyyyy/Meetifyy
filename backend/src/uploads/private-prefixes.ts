/**
 * Key prefixes whose objects are written to the private bucket
 * (`R2_VERIFICATION_BUCKET_NAME`) rather than the main one.
 *
 * Lives in its own file, with no imports, so the storage provider, the
 * relocation routine and the command-line script all read the same list
 * without the script having to load the application's configuration.
 */
export const PRIVATE_PREFIXES: readonly string[] = [
  'verification/',
  // Conversation attachments, for the same reason. The main bucket's public
  // host resolves any key with no authentication, so an object placed there
  // is readable by anyone who ever sees its URL — after the message is
  // deleted, and with no way to revoke it. Authorizing `/api/media` does not
  // help if the CDN will serve the same bytes directly.
  'chat/',
  'messages/',
  'voice/',
  // Support-request attachments. The submitter is usually anonymous and the
  // files are user-supplied (screenshots, PDFs), so they must not be
  // readable through the main bucket's unauthenticated public host. Admins
  // reach them only through a short-lived signed URL.
  'support/',
];
