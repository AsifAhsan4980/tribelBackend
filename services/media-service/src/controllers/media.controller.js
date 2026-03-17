const { prisma, success, error, getUploadUrl: s3Upload, deleteS3Object } = require('shared');
const { randomUUID } = require('crypto');

// POST /api/media/upload-url — generate S3 presigned PUT URL
const getUploadUrl = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { album, contentType, fileName } = req.body;

    if (!contentType || !fileName) {
      return error(res, 'contentType and fileName are required', 400);
    }

    // Build S3 key: album/userId/uuid-filename
    const ext = fileName.split('.').pop();
    const key = `${album || 'uploads'}/${userId}/${randomUUID()}.${ext}`;

    const uploadUrl = await s3Upload(key, contentType);

    return success(res, { uploadUrl, key, contentType });
  } catch (err) {
    next(err);
  }
};

// POST /api/media/confirm — confirm upload, create PictureMeta record
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
        width: width || null,
        height: height || null,
        duration: duration || null,
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

// GET /api/media/:id — get PictureMeta by id
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

// DELETE /api/media/:id — delete PictureMeta + S3 object
const deleteMedia = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;

    const meta = await prisma.pictureMeta.findUnique({ where: { id } });
    if (!meta) {
      return error(res, 'Media not found', 404);
    }

    if (meta.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized', 403);
    }

    // Delete S3 objects
    const keysToDelete = [meta.imageKey, meta.videoKey, meta.thumbnailKey].filter(Boolean);
    for (const key of keysToDelete) {
      try {
        await deleteS3Object(key);
      } catch (s3Err) {
        console.error(`Failed to delete S3 object ${key}:`, s3Err.message);
      }
    }

    await prisma.pictureMeta.delete({ where: { id } });

    return success(res, { message: 'Media deleted' });
  } catch (err) {
    next(err);
  }
};

// GET /api/media/post/:postId — get all media for a post
const getMediaForPost = async (req, res, next) => {
  try {
    const { postId } = req.params;

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

// POST /api/media/link-preview — fetch URL metadata (title, description, image)
const linkPreview = async (req, res, next) => {
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

    // Fetch the URL content
    let html;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(parsedUrl.href, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LinkPreview/1.0)',
        },
      });
      clearTimeout(timeout);

      html = await response.text();
    } catch (fetchErr) {
      return error(res, 'Failed to fetch URL', 422);
    }

    // Extract metadata using regex
    const getMetaContent = (property) => {
      const ogMatch = html.match(
        new RegExp(`<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']*)["']`, 'i')
      );
      if (ogMatch) return ogMatch[1];

      const nameMatch = html.match(
        new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i')
      );
      if (nameMatch) return nameMatch[1];

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
  getUploadUrl,
  confirmUpload,
  getMedia,
  deleteMedia,
  getMediaForPost,
  linkPreview,
};
