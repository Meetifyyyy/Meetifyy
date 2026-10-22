// sanitize-html is ESM-only under ts-jest; this spec reads route metadata and
// never sanitizes, the same stub the other controller specs use.
jest.mock('../utils/sanitize-html.util', () => ({
  sanitizeReplyHtml: (html: string) => html,
  sanitizeArticleHtml: (html: string) => html,
  htmlToPlainText: (html: string) => html,
  escapeHtml: (value: string) => value,
  transformAnchor: () => undefined,
}));

import { IDEMPOTENT_KEY } from './idempotent.decorator';
import { PostsController } from '../../posts/posts.controller';
import { CommunitiesController } from '../../communities/communities.controller';
import { ActivitiesController } from '../../activities/activities.controller';
import { GroupChatsController } from '../../messages/group-chats/group-chats.controller';
import { ActivityDiscussionController } from '../../activities/discussion/activity-discussion.controller';
import { SupportController } from '../../support/support.controller';
import { MessagesController } from '../../messages/messages.controller';

/**
 * The creates the clients key per submission must carry @Idempotent(), or a
 * retry after a lost response creates a duplicate again. The interceptor is
 * opt-in, so a renamed or newly split handler would lose it silently.
 */
const keyed: Array<[string, object]> = [
  ['PostsController.createPost', PostsController.prototype.createPost],
  ['PostsController.addComment', PostsController.prototype.addComment],
  [
    'CommunitiesController.createCommunity',
    CommunitiesController.prototype.createCommunity,
  ],
  [
    'ActivitiesController.createActivity',
    ActivitiesController.prototype.createActivity,
  ],
  [
    'GroupChatsController.createGroup',
    GroupChatsController.prototype.createGroup,
  ],
  [
    'ActivityDiscussionController.sendMessage',
    ActivityDiscussionController.prototype.sendMessage,
  ],
  [
    'SupportController.createMyRequest',
    SupportController.prototype.createMyRequest,
  ],
  [
    'SupportController.createRequest',
    SupportController.prototype.createRequest,
  ],
  [
    'MessagesController.startConversation',
    MessagesController.prototype.startConversation,
  ],
];

describe('@Idempotent() routes', () => {
  it.each(keyed)('%s opts in', (_name, handler) => {
    expect(Reflect.getMetadata(IDEMPOTENT_KEY, handler)).toBe(true);
  });
});
