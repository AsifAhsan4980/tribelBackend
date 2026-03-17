const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-southeast-1' });
const BUCKET = process.env.S3_BUCKET;

const getUploadUrl = async (key, contentType, expiresIn = 300) => {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }), { expiresIn });
};

const getDownloadUrl = async (key, expiresIn = 3600) => {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
};

const deleteS3Object = async (key) => {
  return s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
};

module.exports = { getUploadUrl, getDownloadUrl, deleteS3Object };
