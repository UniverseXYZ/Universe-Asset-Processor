import * as dotenv from "dotenv";
import * as fs from "fs";
import got from "got";
import * as https from "https";
import * as crypto from "crypto";
import request from "request";
import { S3 } from "@aws-sdk/client-s3";
dotenv.config();

// PROCESSING TOOLS
import { fileTypeFromStream } from "file-type";
import { Duplex } from "stream";
import Jimp from "jimp";
import getMediaDimensions from "get-media-dimensions";
import gifResize from "@gumlet/gif-resize";
import extractFrames from "ffmpeg-extract-frames";
import imagemin from "imagemin";
import imageminWebp from "imagemin-webp";
import imageminGif2webp from "imagemin-gif2webp";

// TYPES
import { MimeType } from "./types";

const MAX_GRID_WIDTH = 600;

const s3Client = new S3({
  endpoint: "https://nyc3.digitaloceanspaces.com",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.SPACES_KEY!,
    secretAccessKey: process.env.SPACES_SECRET!,
  },
});

const s3BaseURI = process.env.SPACES_BASE_URI;
const bucketParams = {
  Bucket: process.env.SPACES_BUCKET_NAME,
  Prefix: process.env.SPACES_FOLDER,
};

const handleError = (err) => {
  console.log("ERROR CODE: ", err.err);
  console.log("ERROR MSG: ", err.msg);
};

const fileType = async (url: string) => {
  return new Promise<MimeType>((resolve, reject) => {
    request(url, { method: "HEAD" }, async (err: any, res: any) => {
      if (err) reject({ err: 0, msg: "Error with file type request" });
      else {
        try {
          let detectedType = res.headers["content-type"];
          if (detectedType) {
            if (detectedType === "application/octet-stream") {
              const stream = got.stream(url);
              const mime = await fileTypeFromStream(stream);
              resolve({
                ...mime,
                contentType: mime!.toString().split("/")[0].toLowerCase(),
              });
            } else {
              detectedType = detectedType.toLowerCase().replace("jpeg", "jpg");
              resolve({
                mime: detectedType,
                contentType: detectedType.split("/")[0].toLowerCase(),
                ext: detectedType.split("/")[1],
              });
            }
          } else reject({ err: 1, msg: "No content type specified" });
        } catch {
          reject({ err: 2, msg: "Issue getting file type" });
        }
      }
    });
  });
};

const temporaryStore = async (url: string, mimeType: MimeType) => {
  return new Promise<string>((resolve, reject) => {
    try {
      const fileName = "temp/"
        .concat(crypto.randomBytes(24).toString("hex"))
        .concat(".")
        .concat(mimeType.ext);

      const tempFile = fs.createWriteStream(fileName);
      https.get(url, function (response) {
        response.pipe(tempFile);
        tempFile.on("finish", function () {
          resolve(fileName);
        });
      });
    } catch {
      reject({ err: 3, msg: "Issue storing temp file" });
    }
  });
};

const processGif = async (path: string, dim: any) => {
  return new Promise(async (resolve, reject) => {
    try {
      const dimensions = {
        width: MAX_GRID_WIDTH,
        height: (dim.height * MAX_GRID_WIDTH) / dim.width,
      };

      const tempFile = "temp/"
        .concat(crypto.randomBytes(24).toString("hex"))
        .concat(".gif");
      const write = fs.createWriteStream(tempFile);

      const buf = fs.readFileSync(path);
      await gifResize({
        width: dimensions.width,
        height: dimensions.height,
      })(buf)
        .then(async (data) => {
          const stream = new Duplex();
          stream.push(data);
          stream.push(null);
          stream.pipe(write);

          stream.once("end", async () => {
            const res = await imagemin([tempFile], {
              destination: "temp",
              plugins: [
                imageminGif2webp({
                  quality: 20,
                  mixed: true,
                  lossy: true,
                  method: 0,
                  minimize: true,
                  multiThreading: true,
                }),
              ],
            });

            resolve({
              ...dimensions,
              path: res[0].destinationPath,
              mimeType: {
                mime: "image/webp",
                contentType: "image",
                ext: "webp",
              },
            });
          });
        })
        .catch(() => {
          reject({ err: 3, msg: "Issue reading gif" });
        });
    } catch {
      reject({ err: 3, msg: "Issue processing gif" });
    }
  });
};

const processWebp = async (path: string, dim: any) => {
  return new Promise(async (resolve, reject) => {
    try {
      const dimensions = {
        width: MAX_GRID_WIDTH,
        height: (dim.height * MAX_GRID_WIDTH) / dim.width,
      };
      const res = await imagemin([path], {
        destination: "temp",
        plugins: [
          imageminWebp({
            resize: dimensions,
            quality: 50,
          }),
        ],
      });

      resolve({
        ...dimensions,
        path: res[0].destinationPath,
        mimeType: {
          mime: "image/webp",
          contentType: "image",
          ext: "webp",
        },
      });
    } catch {
      reject({ err: 3, msg: "Issue processing webp" });
    }
  });
};

const processImage = async (path: string, ext: string) => {
  return new Promise(async (resolve, reject) => {
    try {
      const tempFile = "temp/"
        .concat(crypto.randomBytes(24).toString("hex"))
        .concat(".")
        .concat(ext);

      await Jimp.read(path)
        .then(async (image) => {
          await image.resize(MAX_GRID_WIDTH, Jimp.AUTO).writeAsync(tempFile);
        })
        .catch(() => {
          reject({ err: 4, msg: "Issue reading temp image" });
        });

      getMediaDimensions(tempFile, "image").then(async (dimensions) => {
        resolve({
          ...dimensions,
          path: tempFile,
          mimeType: {
            mime: `image/${ext.toLowerCase()}`,
            contentType: "image",
            ext: ext.toLowerCase(),
          },
        });
      });
    } catch {
      reject({ err: 3, msg: "Issue processing image" });
    }
  });
};

const processVideo = async (path: string) => {
  return new Promise(async (resolve, reject) => {
    try {
      const ext = "jpg";
      const tempFrame = "temp/"
        .concat(crypto.randomBytes(24).toString("hex"))
        .concat(".")
        .concat(ext);

      await extractFrames({
        input: path,
        output: tempFrame,
        offsets: [1],
        ffmpegPath: process.env.FFMPEG_PATH,
      });

      const smallThumbnail = await processImage(tempFrame, ext);
      resolve(smallThumbnail);
    } catch {
      reject({ err: 3, msg: "Issue processing video" });
    }
  });
};

const webOptimizer = async (url: string) => {
  return new Promise(async (resolve, reject) => {
    try {
      let mimeType: MimeType | void = await fileType(url).catch((err) =>
        handleError(err)
      );

      let result;
      if (mimeType) {
        const tempFile = await temporaryStore(url, mimeType);

        if (mimeType.contentType === "video") {
          const dimensions = await getMediaDimensions(tempFile, "video");
          const web = await processVideo(tempFile).catch((err) =>
            handleError(err)
          );
          result = { ...dimensions, web };
        } else if (mimeType.ext === "gif") {
          const dimensions = await getMediaDimensions(tempFile, "image");
          const web = await processGif(tempFile, dimensions).catch((err) =>
            handleError(err)
          );
          result = { ...dimensions, web };
        } else if (mimeType.contentType === "image") {
          let web;
          const dimensions = await getMediaDimensions(tempFile, "image");
          if (mimeType.ext === "webp") {
            web = await processWebp(tempFile, dimensions).catch((err) =>
              handleError(err)
            );
          } else {
            web = await processImage(tempFile, mimeType.ext).catch((err) =>
              handleError(err)
            );
          }
          result = { ...dimensions, web };
        }

        console.log(
          `========== PROCESSED ${mimeType.ext.toUpperCase()} ==========`
        );
      }

      resolve({ ...result, mimeType });
    } catch {
      reject({ err: 5, msg: "Issue processing file" });
    }
  }).catch((err) => handleError(err));
};

/* TODO
 * 1. CHANGE RUN SCRIPT TO USE DATABASE INSTEAD OF S3 SAMPLE IMAGES
 * 2. DOES NOT NEED TO BE ASYNC
 * 3. STORE ASSET FROM TEMP TO S3 / CDN
 * 4. DELETE ASSETS FROM TEMP AFTER STORING
 */
const runScript = async () => {
  s3Client.listObjectsV2(bucketParams, async (err: any, data: any) => {
    if (err) console.log(err, err.stack);
    else {
      let i = 0;
      while (i < data.Contents.length) {
        console.log("\nPROCESSING FILE: ", data.Contents[i].Key);
        const result = await webOptimizer(
          s3BaseURI.concat(data.Contents[i].Key)
        );
        console.log(result);
        i++;
      }
    }
  });
};

runScript();
