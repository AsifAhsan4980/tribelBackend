# Lambda Migration Tracker
> **Total: 149 Lambda functions → 16 Express microservices**
> **Status Legend:** `PENDING` | `IN_PROGRESS` | `DONE` | `SKIP` (deprecated/stub)

---

## FEED SERVICE (Port 3005) — 15 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 1 | likerslaGetFollowingFeedDynamo | 3-metric engagement feed: commentEng + likeEng + recentFollowers from UserFollowers, dedup IDs, fetch posts, filter blocks/visibility | PENDING | Complex — 3 parallel queries merged, multi-cursor pagination |
| 2 | likerslaGetFollowingFeedData | Older version of following feed (AppSync-based) | SKIP | Duplicate of #1 (Dynamo version is active) |
| 3 | likerslaGetFriendFeedDynamo | Query UserAcceptedFriend sorted by userLastPostAt, batch fetch posts, filter blocked/uploading/wallPost/visibility | PENDING | Multi-cursor pagination (friends + posts), recursive fetch until 5+ results |
| 4 | likerlsaGetFriendsFeedData | Older version of friend feed | SKIP | Duplicate of #3 |
| 5 | likerslaGetBreackingFeedDynamo | All public posts by postDate DESC, category filters (8 filter types), exclude blocked/share/wall | PENDING | Category filter system (filter 0-8), postBypostDateIndex or postByFilterIndex |
| 6 | likerslaGetBreakingFeedData | Older version of breaking feed | SKIP | Duplicate of #5 |
| 7 | likerslaGetTrendingFeedDynamo | TrendingPostStorage table by postedTimeDiff score ASC, time window (TIME_DEFF hours), category filters | PENDING | Score-based ordering, time window recursion, same filter system as breaking |
| 8 | likerslaGetTrendingData | Identical to #7 but different table env var | SKIP | Merge into #7 |
| 9 | likerslaGetAdminFeedDynamo | Admin-only feed, requires isMasterAccount, search all posts with optional user/post filters | PENDING | Admin authorization check, pinPost status enrichment |
| 10 | likerslaGetAdminFeed | Older version of admin feed | SKIP | Duplicate of #9 |
| 11 | likerSlaGetGroupPostDynamo | Posts by groupId from postByGroupNDateIndex, validate group membership + privacy, filter blocked members | PENDING | Group membership validation, privacy rules (PUBLIC vs PRIVATE) |
| 12 | likerSlaGetGroupPost | Older version | SKIP | Duplicate of #11 |
| 13 | likerSlaGetWallPostDynamo | User's wall posts by postByDateIndex, visibility filtering (Public/Friend/Only), shared post enrichment | PENDING | Visibility rules based on viewer relationship |
| 14 | likerSlaGetWallPost | Older version | SKIP | Duplicate of #13 |
| 15 | likerSlaGetStarPostDynamo | Star contributor's posts filtered by categoryId, same wall logic + category filter | PENDING | Category-specific wall posts |
| 16 | likerSlaGetCommentWisePost | Posts where current user commented, sorted by comment date DESC | PENDING | bycommentUserIDcreatedAtCommentWisePost index |
| 17 | likerslaGetVideoPost | Video-only feed: POPULAR (trending), LATEST (breaking), DEFAULT (combined), videoUploadStatus indexes | PENDING | 3 mode strategies, fallback chain: trending→breaking→latest |
| 18 | likerSlaGetHashTagPost | Posts by hashtag via PostHashTag table, byHashTagLastPostAt index DESC | PENDING | Hashtag index lookup + full post enrichment |

**Active feeds to implement:** 10 (following, friend, breaking, trending, admin, group, wall, star, commentWise, video, hashtag)

---

## POST SERVICE (Port 3003) — 14 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 19 | likerslaPostMutation | Multi-mode: CREATE (transactional with SharePostMeta), DELETE, UPDATE, CHANGE_CATEGORY, BOX_POST, CHANGE_VISIBILITY, CHANGE_UPLOADING. Async notifies friends/followers | PENDING | 7 modes, triggers 3 async Lambdas, UserHighlightedPost tracking |
| 20 | likerslaPostConfirmation | Cognito post-signup hook: creates User profile, bidirectional friend with support account, welcome chat room + message, creates notifications | PENDING | Move to auth-service onRegister hook |
| 21 | likerslaPostHashTag | CREATE/UPDATE/DELETE hashtags for posts, upsert PostHashTag + PostHashTagOnPost junction, totalPost counter | PENDING | Hashtag management with transactional writes |
| 22 | likerslaPinPost | Pin/unpin posts (CREATE/GET modes), removes old pin, isMasterAccount auth | PENDING | Admin-only pin management |
| 23 | likerSlaGetSinglePostDynamo | Single post fetch with full enrichment (user, likes, comments, shares, group info) | PENDING | Rich post response with all relations |
| 24 | likerSlaGetSinglePost | Older version | SKIP | Duplicate |
| 25 | likerslaGetNextPreviousPostByUser | Navigate prev/next posts for a user | PENDING | Cursor-based navigation |
| 26 | likerslaGetTopic | Get post categories | PENDING | Simple lookup |
| 27 | likerslaDeletePostData | STUB — deprecated MySQL delete | SKIP | Not functional |
| 28 | likerslaUpdatePostData | STUB — deprecated MySQL update | SKIP | Not functional |
| 29 | likerslainsertPostData | STUB — deprecated MySQL insert | SKIP | Not functional |
| 30 | likerslaGetPostData | MySQL-era post data fetch | SKIP | Replaced by #23 |
| 31 | likerslaGetReactMeta | React metadata for link previews | PENDING | Link preview extraction |
| 32 | likerslaAddImageFromURL | Download image from URL → save to S3 | PENDING | URL-to-S3 utility |

---

## COMMENT SERVICE (Port 3006) — 4 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 33 | likerslaCreateComment | COMMENT/REPLY modes: transactional create + increment totalComments/totalRiply, PictureMeta for images, PostUserTag for @mentions, CommentWisePost tracking, notifications | PENDING | Complex — transactional with counters, mentions, media, notifications |
| 34 | likerslaUpdateComment | Update comment/reply: diff fields, manage mention changes (add/remove PostUserTag), handle image type changes | PENDING | Mention diff management |
| 35 | likerslaDeleteComment | Delete comment/reply: transactional delete + decrement counters, cascade reply deletion, update CommentWisePost | PENDING | Cascade replies on comment delete |
| 36 | likerSlaGetComments | Get comments for post with pagination | PENDING | Paginated with user enrichment |
| 37 | likerSlaGetReplyUserCount | Count unique reply users per comment | PENDING | Aggregate query |

---

## ENGAGEMENT SERVICE (Port 3007) — 7 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 38 | likerslaAddLikes | LIKE/UNLIKE on Post/Comment/Reply: duplicate check, increment/decrement totalLikes on target + owner.totalLikes + ContributorSetting.totalLikes, create notification | PENDING | 1490 lines — complex counter management across 4 tables |
| 39 | likerslaUpdateTotalLikes | STUB — deprecated MySQL | SKIP | Not functional |
| 40 | likerslaAddViewCount | VIEW/VIEW_BEFORE_LOGIN: increment Post.Totalviews, record unique user views in PostView | PENDING | Duplicate view prevention |
| 41 | likerslaGetLikeUserList | List users who liked a target | PENDING | Paginated user list |
| 42 | LikerSlaInsertTrending | Scoring: (baseLikes + typeBoost + categoryBoost) / timeElapsedMinutes, batch insert to TrendingPostStorage | PENDING | **Critical** — trending score algorithm with boost multipliers |
| 43 | likerSLADeleteTrending | STUB — not implemented | SKIP | Need to implement: clean old trending entries |
| 44 | LikerSLAGetPCLCount | Get Post/Comment/Like counts | PENDING | Aggregate metrics |

---

## STAR CONTRIBUTOR / RANKING SERVICE (within Engagement, Port 3007) — 8 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 45 | likerslaStarContributorDynamo | **Core ranking engine**: aggregate likes→rank→percentile→badge (Gold≤5%, Silver 5-10%), update UserRank + User stars, rank change notifications | PENDING | **Critical** — full ranking algorithm, whole_network + per-category |
| 46 | likerslaStarContributor | MySQL version of #45 | SKIP | Replaced by Dynamo version |
| 47 | likerSlaStarCron | Cron: triggers #45 for whole_network + all groups + all categories | PENDING | **Cron job** — daily recalculation |
| 48 | likerSlaGetStarCategory | User's rankings across all categories they contribute to | PENDING | Read ContributorSetting→lookup names→get UserRank |
| 49 | likerSlaGetStarContributorToFollow | Suggested star contributors to follow: top 30%, exclude blocked/following, limit 4 | PENDING | Filter + exclusion logic |
| 50 | likerSlaGetPopularStarContributorList | Top 10 star contributors globally, exclude blocked/following | PENDING | Global leaderboard |
| 51 | likerslaYourContributorRankings | All rankings for current user (same as #48) | SKIP | Merge into #48 |
| 52 | LikerSlaDeleteUserRank | STUB — not implemented | SKIP | |
| 53 | likerslaTopCommentor | Top comment contributors: users where totalCommentLikes > threshold, top N%, batch replace TopCommentor table | PENDING | **Cron job** — daily top commenter calc |

---

## SOCIAL SERVICE (Port 3004) — 16 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 54 | likerslaFollowUnfollow | FOLLOW/UNFOLLOW/turnOffNotification/turnONNotification: transactional UserFollowers + User counter updates, seeFirst flag for feed priority | PENDING | 4 modes, counter management, notification creation |
| 55 | likerslaFriendUnfriend | SEND/CANCEL/ACCEPT/UNFRIEND: transactional UserFriend + UserAcceptedFriend (bidirectional) + User totalFriends, 3 notification types | PENDING | **Critical** — bidirectional friend records, lastPostAt tracking |
| 56 | likerslaBlockORDeactive | Admin modes: blockByAdmin/UnBlock/makeMaster/deleteMaster/makeVerified/deleteVerified/makeLikerAccount/deleteLikerAccount + Cognito disable | PENDING | 8 admin modes, Cognito integration (remove, use DB flag) |
| 57 | likerslaBlockUnBlock | User Block/UnBlock: create BlockedUser, CASCADE delete friend+follower+acceptedFriend relationships, decrement all counters | PENDING | **Critical** — cascade cleanup of all social relationships on block |
| 58 | likerslaFriendSuggetion | GET: suggest users with stars, exclude blocked/following. CREATE: bulk follow recommended users | PENDING | 2 modes, batch follow execution |
| 59 | likerslaCheckFriends | Check friend/follow status between two users | PENDING | Relationship status lookup |
| 60 | likerslaGetFreiendList | List accepted friends with user info | PENDING | Paginated query |
| 61 | likerslaGetPendingFreiendList | List pending friend requests | PENDING | Pending status filter |
| 62 | likerslaFindFriendList | Search friends by name/username | PENDING | Name-based friend search |
| 63 | likerslaGetFollowerList | List followers with user info | PENDING | Paginated query |
| 64 | likerslaGetFollowingList | List following with user info | PENDING | Paginated query |
| 65 | likerslaGetAllFriendsIds | Get all friend IDs (for bulk operations) | PENDING | ID-only fast query |
| 66 | likerslaGetBlockList | List blocked users | PENDING | Paginated query |
| 67 | likerslainsertBlockData | Helper: insert block data | SKIP | Merged into #57 |
| 68 | likerslaDeleteBlockData | Helper: delete block data | SKIP | Merged into #57 |
| 69 | likerslainsertFollowingData | Helper: insert follow data | SKIP | Merged into #54 |
| 70 | likerslaDeletefollowingData | Helper: delete follow data | SKIP | Merged into #54 |
| 71 | likerslainsertFriendData | Helper: insert friend data | SKIP | Merged into #55 |
| 72 | likerslaDeleteFriendData | Helper: delete friend data | SKIP | Merged into #55 |

---

## NOTIFICATION SERVICE (Port 3012) — 8 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 73 | LikerSLASendPushNoticfication | FCM push: 25+ notification types, builds per-type title/body/data, checks user prefs (pushNotification, isMuteSound), sends to all device tokens | PENDING | **Critical** — 25+ notification type handlers, FCM integration |
| 74 | likerslaCreateNotification | STUB — notifications created via GraphQL in other lambdas | SKIP | |
| 75 | LikerSLAUpdateNoticfication | Mark all user notifications as isSeen=true | PENDING | Batch update |
| 76 | LikerSLAUpdateFrienNoticfication | Mark friend request notifications as seen | PENDING | UserFriend isSeenNotification flag |
| 77 | likerSlaNotifyFriendPost | Async: update all friends' UserAcceptedFriend lastPostAt, trigger trending notifications, story friend notifications | PENDING | Recursive pagination for large friend lists |
| 78 | likerSlaNotifyfollowerPost | Async: notify followers with seeFirst=1 of new post | PENDING | Engagement-filtered notification delivery |
| 79 | likerslaPushNotificationSubscribers | Register/unregister FCM device tokens, dedupe by deviceName per user | PENDING | Device token management |
| 80 | LikerSLADeleteSearchHistory | Delete user's search history entries | PENDING | Simple delete |

---

## AUTH SERVICE (Port 3001) — 8 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 81 | likerslaUserVerification | Phone OTP via Twilio (CREATE/VALIDATE/RESEND), document verification (govID+selfie), admin approve/reject (status 0-5) | PENDING | Twilio SMS, 5-min OTP, multi-step verification flow |
| 82 | likerslaVerifyPrimaryPhoneNo | Primary phone number verification | PENDING | Phone OTP flow |
| 83 | likerSLAVerifyPhoneREST | REST API phone verification | PENDING | REST endpoint version |
| 84 | likerSlaVerifyUser | User verification endpoint | PENDING | Public endpoint |
| 85 | likerslaGetUserDataFromCognito | GET_USER/GET_UNCONFIRMED/COGNITO_CONFIRM/RESET_PASSWORD/EMAIL_CONFIRM: admin Cognito ops | PENDING | Replace Cognito with DB operations + email via Nodemailer |
| 86 | likerslaRevokeUserToken | Full user data purge: delete UserRank, Posts, Groups, Notifications, Cognito user (GDPR) | PENDING | **Critical** — data deletion cascade, replace Cognito delete |
| 87 | likerslaUpdateCognitoPass | Update Cognito password | PENDING | Replace with bcrypt password update |
| 88 | likerslaUpdateUserPass | Update user password | PENDING | Merge with #87 |

---

## USER SERVICE (Port 3002) — 6 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 89 | likerslaAddExistingUserData | Backfill user data from old system | SKIP | Migration-only, one-time use |
| 90 | likerslaSceonderyEmail | Add/update secondary email | PENDING | Simple field update |
| 91 | likerslaUserPhoneNumber | Manage phone numbers | PENDING | Phone number CRUD |
| 92 | likerslaExportUserData | STUB — data export not implemented | SKIP | |
| 93 | likerslaContactSupport | Create support tickets + messages | PENDING | ContactSupport + ContactSupportMessage |
| 94 | likerslaGetFilter / likerslaInsertFilter | User feed filter preferences (category selections) | PENDING | UserFilterSelection CRUD |

---

## STORY SERVICE (Port 3008) — 2 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 95 | likerslaStoryMutation | 11 modes: STORY.CREATE/DELETE/LIKE/UNLIKE/VIEW + COMMENT.CREATE/UPDATE/DELETE/LIKE/UNLIKE + REPLY.CREATE/UPDATE/DELETE. 20-story daily limit, 24h expiry, DailyStory container, mention support | PENDING | **Critical** — 11 modes with transactional writes, all counters, mentions, notifications |
| 96 | likerslaGetStories | GET_MY_STORIES + Feed mode: merge friends+following stories (3-metric engagement sort), 24h window, batch fetch, filter blocks/inactive | PENDING | **Critical** — complex feed with engagement-based sorting, same 3-metric pattern as following feed |

---

## ARTICLE SERVICE (Port 3009) — 4 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 97 | likerslaArticleMutation | CREATE (+ auto-creates LinkPost cross-post), UPDATE, DELETE_BY_USER/ADMIN, BOX/UNBOX, notification control | PENDING | Auto cross-post on create, admin boxing |
| 98 | likerslaArticleCommentMutation | CREATE/UPDATE/DELETE comments+replies with 4 content types (text/link/image/both), image PictureMeta, dual notifications | PENDING | Comment type system, image management |
| 99 | likerslaArticleLikeMutation | LIKE/UNLIKE on article/comment/reply, duplicate prevention, self-like prevention | PENDING | 3 target types |
| 100 | likerslaGetArticle | Breaking + Trending article feeds | PENDING | Feed mode selection |

---

## GROUP SERVICE (Port 3010) — 4 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 101 | likerslaUserGroupMutation | Create group: PUBLIC=Active/ANYONEJOIN, PRIVATE=Pending/ADMINAPPROVAL (requires star contributor) | PENDING | Privacy rules, star contributor requirement for PRIVATE |
| 102 | likerslaGroupJoinLeave | JOIN/LEAVE with approval workflow: ANYONEJOIN→Active, ADMINAPPROVAL→Pending, counter management | PENDING | Approval workflow |
| 103 | likerslaGetGroupMemberList | List group members with user info | PENDING | Paginated member list |
| 104 | likerSlaGetManageAndSuggestedGroup | Discover groups: user's groups + suggested | PENDING | Combined managed + suggested |
| 105 | LikerslaManageEvent | Group event management | PENDING | Event CRUD |
| 106 | likerslaFoundingMember | Send SES email invitations for founding members + contributor nominations | PENDING | Replace SES with Nodemailer |

---

## MESSAGE SERVICE (Port 3011) — 5 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 107 | likerslaMessageMutation | STUB — not implemented in original | PENDING | Need to implement from schema |
| 108 | likerslaUserChatRoomMutation | STUB — not implemented | PENDING | Need to implement from schema |
| 109 | likerslaGetChatUserList | Friends list with chatRoomID lookup (bidirectional composite key), filter blocks/inactive | PENDING | Composite key chat room lookup |
| 110 | LikerSLAUpdateChatRoomStatus | Mark chat rooms as notification-seen | PENDING | Batch update unread rooms |
| 111 | likerslaCheckUserChatRommLimit | Anti-spam: count non-friend message recipients in time window, auto-block if exceeds MAX_MESSAGE_COUNT | PENDING | **Critical** — spam prevention with auto-block |

---

## MEDIA SERVICE (Port 3013) — 5 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 112 | S3Trigger3b9cc148 | S3 trigger: ffmpeg video thumbnail + image dimension extraction | PENDING | Video processing pipeline |
| 113 | S3TrigerNew | S3 trigger: new file processing | PENDING | File processing |
| 114 | LikerSLAMediaConvert | AWS MediaConvert job dispatch for video transcoding | PENDING | Keep MediaConvert or replace with FFmpeg |
| 115 | likerSLAConvertfileUsingMedia | Video conversion wrapper | PENDING | Media conversion |
| 116 | likerslaRekognitionProcess | AWS Rekognition image moderation | PENDING | Keep Rekognition or replace with Cloud Vision |
| 117 | likerslaLinkDataProcessing | Extract link preview metadata (title, description, image) | PENDING | URL metadata extraction |
| 118 | likerSlaGetMetaData | Get file metadata from S3 | PENDING | S3 metadata |

---

## ANALYTICS SERVICE (Port 3014) — 7 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 119 | LikerSLADailyHistory | Aggregate daily metrics: signups, posts, comments, likes, logins by device type, avg session duration | PENDING | Complex aggregation across 5 tables |
| 120 | LikerSLAInsertDailyHistory | Persist daily aggregated history | PENDING | Write aggregated data |
| 121 | likerSlaDailyActivityCorn | **Cron**: daily active user calculation | PENDING | Cron job |
| 122 | likerslaActivityLog | Log user activities | PENDING | Activity event recording |
| 123 | LikerSLAInsertLoginInfo | Record login session data | PENDING | Login tracking |
| 124 | likerslaGetDailyAciveUser | DAU query | PENDING | Active user count |
| 125 | LikerSLADailyHistoryReport | Daily history report query | PENDING | Report query |
| 126 | LikerSLAGetActiveUser | Active user metrics | PENDING | User activity |
| 127 | likerSlaDailyActivityEmailTrigger | **Cron**: send daily activity summary emails | PENDING | Cron + email |
| 128 | likerslaSendActivityLogEmail | Send activity log via email | PENDING | Email via SES→Nodemailer |
| 129 | likerSLADataRoom | REST analytics dashboard: auth/dau/mau/retention endpoints | PENDING | Dashboard APIs |

---

## AD SERVICE (Port 3015) — 6 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 130 | likerslaVideoAd | 7 modes: CREATE/GET/GET_LIST/UPDATE/DELETE/GET_FRONT/VIEW, VideoAdView tracking | PENDING | Full ad lifecycle |
| 131 | likerSlaStaticAdGlue | Static ad management wrapper | PENDING | Static ad CRUD |
| 132 | likerslaAdUserMutation | Ad user management | PENDING | AdUser profile |
| 133 | likerslaCampaignMutation | HighlightedUser CRUD + InterestedUser CRUD + Professional_Account apply/confirm/remove (influencer status 0-5) | PENDING | **Critical** — influencer/professional account system |
| 134 | likerslaCampaignCorn | **Cron**: campaign execution | PENDING | Cron job |
| 135 | likerslaCampaignSendMessage | Send campaign messages to targets | PENDING | Bulk messaging |

---

## MODERATION SERVICE (Port 3016) — 4 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 136 | likerslaCreateReport | Report content: transactional Report + ReportCount upsert (first report creates, subsequent increment), admin resolution archives to ReportCountDone | PENDING | 3-table report lifecycle |
| 137 | LikerSLAGetContentReport | List pending reports for admin | PENDING | Admin report list |
| 138 | LikerSLAUserReport | User-specific report history | PENDING | Per-user reports |
| 139 | likerSlaLogoutByAdmin | STUB — force logout user | PENDING | Implement: revoke all tokens |

---

## COLLABORATION (No dedicated service — add to Post/Article) — 3 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 140 | likerslaCollaborationMutation | 8 modes: CREATE/UPDATE/DELETE_BY_USER/DELETE_BY_ADMIN/BOX/UNBOX/APPROVED_BY_ADMIN/NOTIFICATION, counters init, admin approval | PENDING | Add collaboration routes to article-service or new service |
| 141 | likerslaCollaborationCommentMutation | Comments + replies on collaboration topics | PENDING | Same pattern as article comments |
| 142 | likerslaCollaborationLikeMutation | Likes on topics/comments/replies | PENDING | Same pattern as article likes |

---

## SHARED / MISC — 7 Functions

| # | Lambda Name | Business Logic Summary | Status | Migration Notes |
|---|-------------|----------------------|--------|-----------------|
| 143 | likerbackendslalikersSLANodeModule | Shared Lambda layer (node_modules) | SKIP | Replaced by shared/ workspace package |
| 144 | likerbackendslanodemodule14 | Second shared layer | SKIP | Replaced |
| 145 | likerDemo | Demo/test function | SKIP | Not needed |
| 146 | likerSlaCTtempo | DynamoDB stream trigger placeholder | SKIP | Replace with PostgreSQL triggers |
| 147 | likerslaAutoEventMutation | Auto-event logging | PENDING | Event recording |
| 148 | likerslaSubscribeToExternal | Subscribe user to Mautic CRM on signup | PENDING | External integration |
| 149 | likerslaGetVideoPost (feed) | Already counted in feed service | — | — |

---

## SUMMARY

| Category | Total | Active | Skip/Stub | Migrated |
|----------|-------|--------|-----------|----------|
| Feed | 18 | 10 | 8 | 0 |
| Post | 14 | 8 | 6 | 0 |
| Comment | 5 | 5 | 0 | 0 |
| Engagement | 7 | 5 | 2 | 0 |
| Star/Ranking | 9 | 6 | 3 | 0 |
| Social | 19 | 13 | 6 | 0 |
| Notification | 8 | 7 | 1 | 0 |
| Auth | 8 | 8 | 0 | 0 |
| User | 6 | 4 | 2 | 0 |
| Story | 2 | 2 | 0 | 0 |
| Article | 4 | 4 | 0 | 0 |
| Group | 6 | 6 | 0 | 0 |
| Message | 5 | 5 | 0 | 0 |
| Media | 7 | 7 | 0 | 0 |
| Analytics | 11 | 11 | 0 | 0 |
| Ad | 6 | 6 | 0 | 0 |
| Moderation | 4 | 4 | 0 | 0 |
| Collaboration | 3 | 3 | 0 | 0 |
| Shared/Misc | 7 | 2 | 5 | 0 |
| **TOTAL** | **149** | **116** | **33** | **0** |

**33 functions are SKIP** (deprecated stubs, duplicates, shared layers)
**116 functions need active migration**
