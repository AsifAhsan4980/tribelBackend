const { prisma, success, error, getUploadUrl: s3Upload, deleteS3Object } = require('shared');
const { randomUUID } = require('crypto');

// ─────────────────────────────────────────────────
// POST /api/media/upload-url — generate S3 presigned PUT URL
// ─────────────────────────────────────────────────

const getPresignedUrl = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { album, contentType, fileName } = req.body;

    if (!contentType || !fileName) {
      return error(res, 'contentType and fileName are required', 400);
    }

    // Validate album if provided
    const validAlbums = [
      'profilePhotos', 'coverPhoto', 'personalPhotos', 'featuredPhotos',
      'groupPhoto', 'postPhoto', 'commentPhoto', 'messagePhoto',
      'storyPhoto', 'videoAd', 'adContent', 'blogContent',
      'articleContent', 'supportPhoto',
    ];
    const resolvedAlbum = album && validAlbums.includes(album) ? album : 'uploads';

    // Validate content type
    const allowedPrefixes = ['image/', 'video/', 'application/pdf'];
    const isAllowed = allowedPrefixes.some((prefix) => contentType.startsWith(prefix));
    if (!isAllowed) {
      return error(res, 'Unsupported content type. Allowed: image/*, video/*, application/pdf', 400);
    }

    // Sanitize file name and build S3 key
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${resolvedAlbum}/${randomUUID()}/${sanitizedName}`;
    const uploadUrl = await s3Upload(key, contentType);

    return success(res, { uploadUrl, key, contentType });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// POST /api/media/confirm — confirm upload, create PictureMeta
// ─────────────────────────────────────────────────

const confirmUpload = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const {
      postId,
      commentId,
      messageId,
      groupId,
      album,
      type,
      imageKey,
      videoKey,
      thumbnailKey,
      altText,
      caption,
      width,
      height,
      duration,
      fileSize,
      mimeType,
    } = req.body;

    if (!imageKey && !videoKey) {
      return error(res, 'imageKey or videoKey is required', 400);
    }

    // Verify the referenced post exists if postId is provided
    if (postId) {
      const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
      if (!post) {
        return error(res, 'Referenced post not found', 404);
      }
    }

    const meta = await prisma.pictureMeta.create({
      data: {
        userId,
        postId: postId || null,
        commentId: commentId || null,
        messageId: messageId || null,
        groupId: groupId || null,
        album: album || null,
        type: type || null,
        imageKey: imageKey || null,
        videoKey: videoKey || null,
        thumbnailKey: thumbnailKey || null,
        altText: altText || null,
        caption: caption || null,
        width: width ? Number(width) : null,
        height: height ? Number(height) : null,
        duration: duration ? Number(duration) : null,
        fileSize: fileSize ? BigInt(fileSize) : null,
        mimeType: mimeType || null,
        isProcessed: true,
      },
    });

    // Convert BigInt to string for JSON serialization
    const result = { ...meta, fileSize: meta.fileSize ? meta.fileSize.toString() : null };

    return success(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/media/:id — get PictureMeta by id
// ─────────────────────────────────────────────────

const getMedia = async (req, res, next) => {
  try {
    const { id } = req.params;

    const meta = await prisma.pictureMeta.findUnique({ where: { id } });
    if (!meta) {
      return error(res, 'Media not found', 404);
    }

    const result = { ...meta, fileSize: meta.fileSize ? meta.fileSize.toString() : null };

    return success(res, result);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// DELETE /api/media/:id — delete PictureMeta + S3 objects
// ─────────────────────────────────────────────────

const deleteMedia = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;

    const meta = await prisma.pictureMeta.findUnique({ where: { id } });
    if (!meta) {
      return error(res, 'Media not found', 404);
    }

    // Only owner or admin can delete
    if (meta.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to delete this media', 403);
    }

    // Delete all associated S3 objects
    const keysToDelete = [meta.imageKey, meta.videoKey, meta.thumbnailKey].filter(Boolean);
    const deleteResults = await Promise.allSettled(
      keysToDelete.map((key) => deleteS3Object(key))
    );

    // Log any S3 deletion failures (non-blocking)
    for (let i = 0; i < deleteResults.length; i++) {
      if (deleteResults[i].status === 'rejected') {
        console.error(`Failed to delete S3 object ${keysToDelete[i]}:`, deleteResults[i].reason?.message);
      }
    }

    await prisma.pictureMeta.delete({ where: { id } });

    return success(res, { message: 'Media deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/media/post/:postId — all media for a post
// ─────────────────────────────────────────────────

const getMediaForPost = async (req, res, next) => {
  try {
    const { postId } = req.params;

    // Verify post exists
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, isDeleted: true },
    });
    if (!post) {
      return error(res, 'Post not found', 404);
    }
    if (post.isDeleted) {
      return error(res, 'Post has been deleted', 410);
    }

    const media = await prisma.pictureMeta.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
    });

    const result = media.map((m) => ({
      ...m,
      fileSize: m.fileSize ? m.fileSize.toString() : null,
    }));

    return success(res, result);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// POST /api/media/link-preview — fetch URL metadata
// ─────────────────────────────────────────────────

const getLinkPreview = async (req, res, next) => {
  try {
    const { url } = req.body;

    if (!url) {
      return error(res, 'url is required', 400);
    }

    // Validate URL format
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return error(res, 'Invalid URL format', 400);
    }

    // Only allow http(s)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return error(res, 'Only HTTP and HTTPS URLs are supported', 400);
    }

    // Check against blocked links
    const blockedLink = await prisma.blockedLink.findFirst({
      where: {
        OR: [
          { url: parsedUrl.href },
          { domain: parsedUrl.hostname },
        ],
      },
    });
    if (blockedLink) {
      return error(res, 'This URL has been blocked', 403);
    }

    // Fetch the URL content with timeout
    let html;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(parsedUrl.href, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LinkPreview/1.0)',
          Accept: 'text/html',
        },
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return error(res, `URL returned status ${response.status}`, 422);
      }

      // Only read text/html responses
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return success(res, {
          url: parsedUrl.href,
          title: null,
          description: null,
          image: null,
          siteName: null,
          domain: parsedUrl.hostname,
        });
      }

      html = await response.text();
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') {
        return error(res, 'URL fetch timed out (5s limit)', 422);
      }
      return error(res, 'Failed to fetch URL', 422);
    }

    // Extract metadata using regex
    const getMetaContent = (property) => {
      // Try og: prefixed property first
      const ogMatch = html.match(
        new RegExp(`<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']*)["']`, 'i')
      );
      if (ogMatch) return ogMatch[1];

      // Try reversed attribute order (content before property)
      const ogRev = html.match(
        new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${property}["']`, 'i')
      );
      if (ogRev) return ogRev[1];

      // Try name attribute
      const nameMatch = html.match(
        new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i')
      );
      if (nameMatch) return nameMatch[1];

      // Try reversed name attribute
      const nameRev = html.match(
        new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${property}["']`, 'i')
      );
      if (nameRev) return nameRev[1];

      return null;
    };

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = getMetaContent('title') || (titleMatch ? titleMatch[1].trim() : null);
    const description = getMetaContent('description') || null;
    const image = getMetaContent('image') || null;
    const siteName = getMetaContent('site_name') || null;

    return success(res, {
      url: parsedUrl.href,
      title,
      description,
      image,
      siteName,
      domain: parsedUrl.hostname,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPresignedUrl,
  confirmUpload,
  getMedia,
  deleteMedia,
  getMediaForPost,
  getLinkPreview,
};
