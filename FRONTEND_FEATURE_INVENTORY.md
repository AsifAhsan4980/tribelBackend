# Frontend Feature Inventory for Migration
> Maps every frontend-facing feature to its current Lambda backend and new Express endpoint

---

## 1. AUTHENTICATION & ACCOUNT

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| Email/Password Register | likerslaPostConfirmation (Cognito trigger) | Cognito SignUp | POST /api/auth/register | P0 |
| Email/Password Login | Cognito InitiateAuth | Cognito Auth | POST /api/auth/login | P0 |
| Google OAuth Login | — (new) | — | GET /api/auth/google | P0 |
| Apple Sign-In | — (new) | — | POST /api/auth/apple | P0 |
| Token Refresh | Cognito | Cognito | POST /api/auth/refresh | P0 |
| Logout | likerslaRevokeUserToken | GraphQL mutation | POST /api/auth/logout | P0 |
| Forgot Password | likerslaGetUserDataFromCognito (RESET_PASSWORD) | GraphQL | POST /api/auth/forgot-password | P1 |
| Change Password | likerslaUpdateCognitoPass | GraphQL | POST /api/auth/change-password | P1 |
| Phone Verification (send OTP) | likerslaUserVerification (CREATE) | GraphQL | POST /api/auth/phone/send-otp | P1 |
| Phone Verification (confirm) | likerslaUserVerification (VALIDATE) | GraphQL | POST /api/auth/phone/verify | P1 |
| Email Verification | likerslaGetUserDataFromCognito (EMAIL_CONFIRM) | GraphQL | POST /api/auth/verify-email | P1 |
| Identity Verification | likerslaUserVerification (CREATE+ADMIN_VERIFY) | GraphQL | POST /api/auth/identity/submit, PUT /api/auth/identity/:id/review | P2 |
| Delete Account (GDPR) | likerslaRevokeUserToken | GraphQL | DELETE /api/auth/account | P1 |

---

## 2. USER PROFILE

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| View own profile | likerslaGetUserDataFromCognito | GraphQL | GET /api/users/me | P0 |
| View other user profile | AppSync getUser | GraphQL | GET /api/users/:userId | P0 |
| Update profile | AppSync updateUser | GraphQL | PUT /api/users/me | P0 |
| Update secondary email | likerslaSceonderyEmail | GraphQL | PUT /api/users/me/secondary-email | P2 |
| Upload profile photo | S3 presigned URL | REST | POST /api/media/upload-url | P0 |
| Education CRUD | AppSync | GraphQL | GET/POST/PUT/DELETE /api/users/education | P2 |
| Experience CRUD | AppSync | GraphQL | GET/POST/PUT/DELETE /api/users/experience | P2 |
| Awards/Certificates | AppSync | GraphQL | GET/POST /api/users/awards | P3 |
| Search users | AppSync searchUsers | GraphQL | GET /api/users/search?q= | P1 |
| Search history | LikerSLADeleteSearchHistory | GraphQL | DELETE /api/users/search-history | P2 |
| Export data | likerslaExportUserData | GraphQL | POST /api/users/me/export | P3 |
| Contact support | likerslaContactSupport | GraphQL | POST /api/users/support | P2 |
| Feed filter preferences | likerslaGetFilter/likerslaInsertFilter | REST | GET/POST /api/users/me/filters | P1 |

---

## 3. FEEDS (Main App Screens)

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| Following Feed | likerslaGetFollowingFeedDynamo | GraphQL | GET /api/feed/following | **P0** |
| Friends Feed | likerslaGetFriendFeedDynamo | GraphQL | GET /api/feed/friends | **P0** |
| Breaking Feed (All/Discover) | likerslaGetBreackingFeedDynamo | GraphQL | GET /api/feed/breaking | **P0** |
| Trending Feed | likerslaGetTrendingFeedDynamo | GraphQL | GET /api/feed/trending | **P0** |
| Admin Feed | likerslaGetAdminFeedDynamo | GraphQL | GET /api/feed/admin | P1 |
| Group Feed | likerSlaGetGroupPostDynamo | GraphQL | GET /api/feed/group/:groupId | **P0** |
| User Wall | likerSlaGetWallPostDynamo | GraphQL | GET /api/feed/wall/:userId | **P0** |
| Star Contributor Posts | likerSlaGetStarPostDynamo | GraphQL | GET /api/feed/star/:userId?categoryId= | P1 |
| Comment-wise Posts | likerSlaGetCommentWisePost | GraphQL | GET /api/feed/comment-activity | P2 |
| Video Feed | likerslaGetVideoPost | GraphQL | GET /api/feed/videos?mode= | P1 |
| Hashtag Feed | likerSlaGetHashTagPost | GraphQL | GET /api/feed/hashtag/:tag | P1 |

**Feed params (all feeds):** `?page=&limit=&nextToken=&categoryId=&filter=&isPublic=`

---

## 4. POSTS

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| Create post | likerslaPostMutation (CREATE) | GraphQL | POST /api/posts | P0 |
| Update post | likerslaPostMutation (UPDATE) | GraphQL | PUT /api/posts/:id | P0 |
| Delete post | likerslaPostMutation (DELETE) | GraphQL | DELETE /api/posts/:id | P0 |
| Get single post | likerSlaGetSinglePostDynamo | GraphQL | GET /api/posts/:id | P0 |
| Change visibility | likerslaPostMutation (CHANGE_VISIBILITY) | GraphQL | PATCH /api/posts/:id/visibility | P1 |
| Change category | likerslaPostMutation (CHANGE_CATEGORY) | GraphQL | PATCH /api/posts/:id/category | P1 |
| Box/Unbox post (admin) | likerslaPostMutation (BOX_POST) | GraphQL | PATCH /api/posts/:id/block | P1 |
| Pin post | likerslaPinPost | GraphQL | POST/DELETE /api/posts/:id/pin | P1 |
| Share post | likerslaPostMutation (CREATE with isSharePost) | GraphQL | POST /api/posts/:id/share | P1 |
| Add hashtags | likerslaPostHashTag | GraphQL | POST /api/posts/:id/hashtags | P1 |
| Navigate prev/next | likerslaGetNextPreviousPostByUser | GraphQL | GET /api/posts/user/:userId/nav?current= | P2 |
| Post categories | likerslaGetTopic | GraphQL | GET /api/posts/categories | P1 |

---

## 5. COMMENTS & REPLIES

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| Add comment | likerslaCreateComment (COMMENT) | GraphQL | POST /api/comments | P0 |
| Add reply | likerslaCreateComment (REPLY) | GraphQL | POST /api/comments/:commentId/replies | P0 |
| Update comment | likerslaUpdateComment | GraphQL | PUT /api/comments/:id | P1 |
| Delete comment | likerslaDeleteComment | GraphQL | DELETE /api/comments/:id | P0 |
| Get post comments | likerSlaGetComments | GraphQL | GET /api/comments/post/:postId | P0 |
| Get comment replies | likerSlaGetComments | GraphQL | GET /api/comments/:commentId/replies | P0 |
| @Mention in comment | likerslaCreateComment (hasMention) | GraphQL | (part of POST /api/comments body) | P1 |

---

## 6. LIKES & ENGAGEMENT

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| Like post | likerslaAddLikes (LIKE, Post) | GraphQL | POST /api/engagement/likes | P0 |
| Unlike post | likerslaAddLikes (UNLIKE, Post) | GraphQL | DELETE /api/engagement/likes/Post/:id | P0 |
| Like comment | likerslaAddLikes (LIKE, Comment) | GraphQL | POST /api/engagement/likes | P0 |
| Like reply | likerslaAddLikes (LIKE, Reply) | GraphQL | POST /api/engagement/likes | P0 |
| List who liked | likerslaGetLikeUserList | GraphQL | GET /api/engagement/likes/:type/:id | P1 |
| View post | likerslaAddViewCount | GraphQL | POST /api/engagement/views | P1 |
| View post (guest) | likerslaAddViewCount (VIEW_BEFORE_LOGIN) | GraphQL | POST /api/engagement/views/guest | P2 |

---

## 7. SOCIAL GRAPH

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| Follow user | likerslaFollowUnfollow (FOLLOW) | GraphQL | POST /api/social/follow | P0 |
| Unfollow user | likerslaFollowUnfollow (UNFOLLOW) | GraphQL | DELETE /api/social/follow/:userId | P0 |
| Turn off follower notifications | likerslaFollowUnfollow (turnOffNotification) | GraphQL | PUT /api/social/follow/:userId/notifications | P2 |
| Send friend request | likerslaFriendUnfriend (SEND) | GraphQL | POST /api/social/friend | P0 |
| Accept friend request | likerslaFriendUnfriend (ACCEPT) | GraphQL | PUT /api/social/friend/:userId/accept | P0 |
| Reject friend request | likerslaFriendUnfriend (CANCEL) | GraphQL | PUT /api/social/friend/:userId/reject | P0 |
| Unfriend | likerslaFriendUnfriend (UNFRIEND) | GraphQL | DELETE /api/social/friend/:userId | P0 |
| Block user | likerslaBlockUnBlock (Block) | GraphQL | POST /api/social/block | P0 |
| Unblock user | likerslaBlockUnBlock (UnBlock) | GraphQL | DELETE /api/social/block/:userId | P1 |
| List followers | likerslaGetFollowerList | GraphQL | GET /api/social/followers/:userId | P0 |
| List following | likerslaGetFollowingList | GraphQL | GET /api/social/following/:userId | P0 |
| List friends | likerslaGetFreiendList | GraphQL | GET /api/social/friends | P0 |
| Pending requests | likerslaGetPendingFreiendList | GraphQL | GET /api/social/friends/pending | P0 |
| Friend suggestions | likerslaFriendSuggetion (GET) | GraphQL | GET /api/social/friends/suggestions | P1 |
| Bulk follow suggested | likerslaFriendSuggetion (CREATE) | GraphQL | POST /api/social/friends/bulk-follow | P2 |
| Check friend status | likerslaCheckFriends | GraphQL | GET /api/social/status/:userId | P1 |
| Blocked list | likerslaGetBlockList | GraphQL | GET /api/social/blocked | P1 |

---

## 8. STAR CONTRIBUTORS & RANKINGS

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| My rankings | likerSlaGetStarCategory / likerslaYourContributorRankings | GraphQL | GET /api/engagement/rankings/me | P1 |
| Star contributors to follow | likerSlaGetStarContributorToFollow | GraphQL | GET /api/engagement/rankings/suggested | P1 |
| Popular star contributors | likerSlaGetPopularStarContributorList | GraphQL | GET /api/engagement/rankings/top | P1 |
| Category rankings | likerslaStarContributorDynamo (read) | GraphQL | GET /api/engagement/rankings/category/:id | P2 |
| Top commenters | likerslaTopCommentor (read) | GraphQL | GET /api/engagement/rankings/commenters | P2 |

**Background (no frontend):** likerSlaStarCron triggers likerslaStarContributorDynamo daily

---

## 9. STORIES

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| Create story | likerslaStoryMutation (STORY.CREATE) | GraphQL | POST /api/stories | P0 |
| Delete story | likerslaStoryMutation (STORY.DELETE) | GraphQL | DELETE /api/stories/:id | P0 |
| Like story | likerslaStoryMutation (STORY.LIKE) | GraphQL | POST /api/stories/:id/like | P1 |
| Unlike story | likerslaStoryMutation (STORY.UNLIKE) | GraphQL | DELETE /api/stories/:id/like | P1 |
| View story | likerslaStoryMutation (STORY.VIEW) | GraphQL | POST /api/stories/:id/view | P0 |
| Story comments | likerslaStoryMutation (COMMENT.*) | GraphQL | POST/DELETE /api/stories/:id/comments | P1 |
| Story replies | likerslaStoryMutation (REPLY.*) | GraphQL | POST/DELETE /api/stories/:id/comments/:cid/replies | P2 |
| Story feed | likerslaGetStories | GraphQL | GET /api/stories/feed | P0 |
| My stories | likerslaGetStories (GET_MY_STORIES) | GraphQL | GET /api/stories/me | P0 |

---

## 10. ARTICLES

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| Create article | likerslaArticleMutation (CREATE) | GraphQL | POST /api/articles | P1 |
| Update article | likerslaArticleMutation (UPDATE) | GraphQL | PUT /api/articles/:id | P1 |
| Delete article | likerslaArticleMutation (DELETE) | GraphQL | DELETE /api/articles/:id | P1 |
| Get article | likerslaGetArticle | GraphQL | GET /api/articles/:id | P1 |
| Article feed | likerslaGetArticle (Breaking/Trending) | GraphQL | GET /api/articles?mode= | P1 |
| Article comments | likerslaArticleCommentMutation | GraphQL | POST/PUT/DELETE /api/articles/:id/comments | P1 |
| Article likes | likerslaArticleLikeMutation | GraphQL | POST/DELETE /api/articles/:id/like | P1 |
| Box/Unbox (admin) | likerslaArticleMutation (BOX) | GraphQL | PATCH /api/articles/:id/block | P2 |

---

## 11. GROUPS

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| Create group | likerslaUserGroupMutation | GraphQL | POST /api/groups | P0 |
| Update group | likerslaUserGroupMutation | GraphQL | PUT /api/groups/:id | P1 |
| Delete group | likerslaUserGroupMutation | GraphQL | DELETE /api/groups/:id | P1 |
| Join group | likerslaGroupJoinLeave (JOIN) | GraphQL | POST /api/groups/:id/join | P0 |
| Leave group | likerslaGroupJoinLeave (LEAVE) | GraphQL | POST /api/groups/:id/leave | P0 |
| Group members | likerslaGetGroupMemberList | GraphQL | GET /api/groups/:id/members | P0 |
| Discover groups | likerSlaGetManageAndSuggestedGroup | GraphQL | GET /api/groups/discover | P1 |
| My groups | likerSlaGetManageAndSuggestedGroup | GraphQL | GET /api/groups/me | P0 |
| Manage events | LikerslaManageEvent | GraphQL | POST/PUT/DELETE /api/groups/:id/events | P2 |
| Founding member invite | likerslaFoundingMember | GraphQL | POST /api/groups/:id/invite | P2 |

---

## 12. MESSAGING

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| Get chat contacts | likerslaGetChatUserList | GraphQL | GET /api/messages/contacts | P0 |
| Create/get chat room | likerslaUserChatRoomMutation | GraphQL | POST /api/messages/rooms | P0 |
| Send message | likerslaMessageMutation | GraphQL | POST /api/messages | P0 |
| Get room messages | (AppSync query) | GraphQL | GET /api/messages/room/:roomId | P0 |
| Update room status | LikerSLAUpdateChatRoomStatus | GraphQL | PUT /api/messages/rooms/:id/status | P1 |
| Mark notifications seen | LikerSLAUpdateChatRoomStatus | GraphQL | PUT /api/messages/mark-seen | P1 |
| Spam check | likerslaCheckUserChatRommLimit | GraphQL | (internal middleware) | P1 |

---

## 13. NOTIFICATIONS

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| List notifications | (AppSync query) | GraphQL | GET /api/notifications | P0 |
| Mark all as seen | LikerSLAUpdateNoticfication | GraphQL | PUT /api/notifications/mark-seen | P0 |
| Unseen count | (AppSync query) | GraphQL | GET /api/notifications/unseen-count | P0 |
| Register device token | likerslaPushNotificationSubscribers | GraphQL | POST /api/notifications/device-token | P0 |
| Remove device token | likerslaPushNotificationSubscribers | GraphQL | DELETE /api/notifications/device-token/:deviceId | P1 |
| Push notification | LikerSLASendPushNoticfication | (internal) | (internal — triggered by events) | P0 |

**Real-time (WebSocket):**
| Event | Current | New |
|-------|---------|-----|
| New notification | AppSync subscription | Socket.io `notification:new` |
| New message | AppSync subscription | Socket.io `message:new` |
| Friend request | AppSync subscription | Socket.io `friend:request` |
| Chat room update | AppSync subscription | Socket.io `chatroom:updated` |

---

## 14. MEDIA

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| Get upload URL | S3 presigned (Amplify) | Amplify Storage | POST /api/media/upload-url | P0 |
| Confirm upload | likerslaPostMutation side effect | GraphQL | POST /api/media/confirm | P0 |
| Link preview | likerslaLinkDataProcessing | REST | POST /api/media/link-preview | P1 |
| Get metadata | likerSlaGetMetaData | REST | GET /api/media/:id | P2 |

---

## 15. ADMIN PANEL

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| Admin feed | likerslaGetAdminFeedDynamo | GraphQL | GET /api/feed/admin | P1 |
| Block/unblock user | likerslaBlockORDeactive | GraphQL | POST /api/moderation/users/:id/block | P1 |
| Make/remove master | likerslaBlockORDeactive | GraphQL | PUT /api/moderation/users/:id/role | P2 |
| Verify user (admin) | likerslaUserVerification (ADMIN_VERIFY) | GraphQL | PUT /api/moderation/users/:id/verify | P1 |
| View reports | LikerSLAGetContentReport | GraphQL | GET /api/moderation/reports | P1 |
| Resolve report | likerslaCreateReport (update) | GraphQL | PUT /api/moderation/reports/:id | P1 |
| Pin post | likerslaPinPost | GraphQL | POST /api/posts/:id/pin | P1 |
| Box post/article | likerslaPostMutation (BOX) | GraphQL | PATCH /api/posts/:id/block | P1 |
| Force logout | likerSlaLogoutByAdmin | GraphQL | POST /api/moderation/users/:id/logout | P2 |
| Daily analytics | LikerSLADailyHistory | REST | GET /api/analytics/daily | P2 |
| Active users | likerslaGetDailyAciveUser | REST | GET /api/analytics/active-users | P2 |

---

## 16. ADVERTISING

| Feature | Current Lambda | Current API | New Endpoint | Priority |
|---------|---------------|-------------|--------------|----------|
| Create static ad | likerSlaStaticAdGlue | GraphQL | POST /api/ads/static | P2 |
| Create video ad | likerslaVideoAd | GraphQL | POST /api/ads/video | P2 |
| List ads (frontend) | likerslaVideoAd (GET_FRONT) | GraphQL | GET /api/ads/active | P2 |
| Record ad view | likerslaVideoAd (VIEW) | GraphQL | POST /api/ads/:id/view | P2 |
| Campaign management | likerslaCampaignMutation | GraphQL | POST /api/ads/campaigns | P3 |
| Influencer application | likerslaCampaignMutation (Professional_Account) | GraphQL | POST /api/ads/influencer/apply | P2 |
| Influencer approval | likerslaCampaignMutation (Professional_Account_Confirm) | GraphQL | PUT /api/ads/influencer/:id/approve | P2 |

---

## PRIORITY SUMMARY

| Priority | Count | Description |
|----------|-------|-------------|
| **P0** | ~45 | Core functionality — app doesn't work without it |
| **P1** | ~35 | Important features — needed for full experience |
| **P2** | ~25 | Secondary features — can launch without |
| **P3** | ~5 | Nice-to-have — build later |
