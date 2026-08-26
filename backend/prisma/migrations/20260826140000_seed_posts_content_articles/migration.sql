-- Two articles for the "Posts & Content" category.
--
-- The initial seed created the category with nothing in it, which is the exact
-- state AdminHelpService.setCategoryStatus refuses to let an admin publish —
-- a heading on the public page with no articles under it. Same idempotent
-- insert as the first seed, so re-running changes nothing.


INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'how-do-i-create-a-post', c."id", 'How do I create a post?', 'Use the composer on your feed to write a post, add photos, video or a poll, and choose where it goes.',
  '<p>Open your feed and use the composer at the top. You can add text, photos or video, and turn a post into a poll.</p>
<p>Before you post, choose where it goes: your own feed, or one of the communities you''re a member of. A post in a community is visible to that community''s members and follows its rules.</p>
<p>You can edit or delete your own posts afterwards from the menu on the post itself. Deleting removes it along with its comments.</p>',
  ARRAY['create post','new post','write post','share','upload photo','poll']::TEXT[], 0, false, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'posts-content'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'why-was-my-post-removed', c."id", 'Why was my post or comment removed?', 'Content is removed when it breaks the Community Guidelines. You can ask us to review the decision.',
  '<p>Posts and comments are removed when they break our <strong>Community Guidelines</strong> — most often for harassment, hate speech, sexual content, spam, or sharing someone''s personal information without their consent.</p>
<p>A post can also disappear for reasons that aren''t moderation at all:</p>
<ul>
<li>The community it was posted in was deleted, or you left it.</li>
<li>The author''s account was deleted, which removes their content with it.</li>
<li>You blocked the author, or they blocked you, which hides their content from you.</li>
</ul>
<p>If you think a removal was a mistake, send us a support request under <strong>Posts &amp; Content</strong>. Tell us roughly what the post said and when you made it, and we''ll review it.</p>',
  ARRAY['post removed','deleted my post','comment removed','takedown','appeal','moderation']::TEXT[], 1, false, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'posts-content'
ON CONFLICT ("slug") DO NOTHING;
