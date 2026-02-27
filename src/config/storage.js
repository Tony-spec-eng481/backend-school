import { Storage } from "@google-cloud/storage";

const storage = new Storage({
  keyFilename: "./service-account.json", // path to downloaded JSON
});

const bucket = storage.bucket("learn-multimedia");

export { storage, bucket };
