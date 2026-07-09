// ===== Cloudflare R2 client (S3-compatible) — backup/restore CLAUDE.md deployment plan =====
// Lazy-fail เหมือน secretsCrypto.js: ไม่ throw ตอน require, throw เฉพาะตอนถูกเรียกใช้จริงโดยไม่ได้ตั้งค่า
// R2_* env vars — ฟีเจอร์ backup-to-cloud เป็น optional, VPS/local deploy ที่ไม่ได้ตั้งค่าต้อง boot ได้ปกติ
//
// ต้องตั้ง requestChecksumCalculation/responseChecksumValidation เป็น 'WHEN_REQUIRED' เสมอ — @aws-sdk/client-s3
// เวอร์ชันใหม่ (~v3.729+) เปิด flexible-checksum header/trailer เป็น default ซึ่ง R2 (S3-compatible แต่ไม่ใช่ AWS
// จริง) ปฏิเสธ/parse ผิดได้ — ทำให้ upload พังแบบ error ที่งงมาก ถ้าไม่ตั้งค่านี้
const fs = require('fs');

let _client = null;
function getConfig() {
  const accountId = process.env.R2_ACCOUNT_ID || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
  const bucket = process.env.R2_BUCKET || '';
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('R2 ยังไม่ได้ตั้งค่า — ต้องมี R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET ใน env');
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

function isConfigured() {
  try { getConfig(); return true; } catch { return false; }
}

function getClient() {
  if (_client) return _client;
  const { accountId, accessKeyId, secretAccessKey } = getConfig();
  const { S3Client } = require('@aws-sdk/client-s3');
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // กัน R2 ปฏิเสธ/parse checksum header ผิด (ดูหมายเหตุด้านบน)
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return _client;
}

async function putObjectFromFile(key, filePath) {
  const { bucket } = getConfig();
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = getClient();
  const size = fs.statSync(filePath).size;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fs.createReadStream(filePath),
    ContentLength: size,
  }));
  return { size };
}

async function putJson(key, obj) {
  const { bucket } = getConfig();
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = getClient();
  const body = Buffer.from(JSON.stringify(obj, null, 2), 'utf8');
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/json',
    ContentLength: body.length,
  }));
}

// คืน null ถ้าไม่มี object (ไม่ throw — ให้ caller ตัดสินใจ fallback เอง)
async function getJson(key) {
  const { bucket } = getConfig();
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const client = getClient();
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks = [];
    for await (const chunk of res.Body) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

async function getObjectToFile(key, destPath) {
  const { bucket } = getConfig();
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const client = getClient();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    res.Body.pipe(out);
    res.Body.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
  });
}

// คืน [] ถ้า prefix ไม่มี object เลย — ใช้เป็น fallback ตอน manifest.json หายไป/อ่านไม่ออก
async function listObjects(prefix) {
  const { bucket } = getConfig();
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
  const client = getClient();
  const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  return (res.Contents || []).map(o => ({ key: o.Key, lastModified: o.LastModified, size: o.Size }));
}

module.exports = { isConfigured, putObjectFromFile, putJson, getJson, getObjectToFile, listObjects };
