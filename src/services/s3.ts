import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET!;

const returnUrl = (key: string) =>
  `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;

// ---- Single file upload ----
export const uploadFile = async (
  file: File,
  folder = "uploads",
  skipUuid = false
) => {
  const buffer = Buffer.from(await file.arrayBuffer());
  const key = skipUuid
    ? `${folder}/${file.name}`
    : `${folder}/${uuidv4()}-${file.name}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: file.type || "application/octet-stream",
  });

  await s3Client.send(command);
  return returnUrl(key);
};

// Presigned URL
export const getPresignedUrl = async (
  filename: string,
  contentType: string,
  folder = "uploads"
) => {
  const key = `${folder}/${uuidv4()}-${filename}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  return { url, key };
};

// ---- Delete file ----
export const deleteFile = async (url: string) => {
  const key = url.split(".amazonaws.com/")[1];

  if (!key) {
    // console.warn("Could not extract S3 key from URL:");
    return;
  }

  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const result = await s3Client.send(command);

  return { deleted: true };
};

// ---- Multiple file upload ----
export const uploadFiles = async (files: File[], folder = "uploads") => {
  const uploadPromises = files.map((file) => uploadFile(file, folder));
  return Promise.all(uploadPromises);
};

// ---- Update file (re-upload with same key) ----
export const updateFile = async (file: File, key: string) => {
  const buffer = Buffer.from(await file.arrayBuffer());

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: file.type || "application/octet-stream",
  });

  await s3Client.send(command);
  return returnUrl(key);
};
