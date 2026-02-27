import { bucket } from '../config/storage.js';
import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';
  
/**
 * Uploads a file to Google Cloud Storage and returns the public URL.
 * @param {Object} file - The file object from multer (req.file or req.files[field][0])
 * @returns {Promise<string|null>} - The public URL of the uploaded file
 */
export const uploadToGCS = (file) => {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);

    const originalName = file.originalname;
    const filename = `${uuidv4()}-${originalName}`;
    const blob = bucket.file(filename);

    const blobStream = blob.createWriteStream({
      resumable: false,
      metadata: {       
          contentType: file.mimetype,
      },  
    });

    blobStream.on('error', (err) => {
      console.error('GCS Upload Error:', err);
      reject(err);
    });

    blobStream.on('finish', () => {
      // The public URL can be used directly to access the file via HTTP.
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
      resolve(publicUrl);
    });

    Readable.from(file.buffer).pipe(blobStream);
  });
};
