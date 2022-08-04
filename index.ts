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

const s3BaseURI = "https://cdn.grants.art/";
const bucketParams = { Bucket: "grants", Prefix: "test-images" };

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
          const detectedType = res.headers["content-type"];
          if (detectedType) {
            if (detectedType === "application/octet-stream") {
              const stream = got.stream(url);
              const mime = await fileTypeFromStream(stream);
              resolve({
                ...mime,
                contentType: mime!.toString().split("/")[0].toLowerCase(),
              });
            } else
              resolve({
                mime: detectedType,
                contentType: detectedType.split("/")[0].toLowerCase(),
                ext: detectedType.split("/")[1],
              });
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

const processGif = async (path: string) => {
  return new Promise(async (resolve, reject) => {
    try {
      const tempFile = "temp/"
        .concat(crypto.randomBytes(24).toString("hex"))
        .concat(".gif");
      const write = fs.createWriteStream(tempFile);

      const buf = fs.readFileSync(path);
      await gifResize({
        width: MAX_GRID_WIDTH,
        optimizationLevel: 3,
      })(buf)
        .then(async (data) => {
          const stream = new Duplex();
          stream.push(data);
          stream.push(null);
          stream.pipe(write);

          stream.once("end", () => {
            getMediaDimensions(tempFile, "image").then(async (dimensions) => {
              resolve({ ...dimensions, path: tempFile });
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

const processImage = async (path: string) => {
  return new Promise(async (resolve, reject) => {
    try {
      const tempFile = "temp/"
        .concat(crypto.randomBytes(24).toString("hex"))
        .concat(".jpg");

      await Jimp.read(path)
        .then(async (image) => {
          await image.resize(MAX_GRID_WIDTH, Jimp.AUTO).writeAsync(tempFile);
        })
        .catch(() => {
          reject({ err: 4, msg: "Issue reading temp image" });
        });

      getMediaDimensions(tempFile, "image").then(async (dimensions) => {
        resolve({ ...dimensions, path: tempFile });
      });
    } catch {
      reject({ err: 3, msg: "Issue processing image" });
    }
  });
};

const processVideo = async (path: string) => {
  return new Promise(async (resolve, reject) => {
    try {
      const tempFrame = "temp/"
        .concat(crypto.randomBytes(24).toString("hex"))
        .concat(".jpg");

      await extractFrames({
        input: path,
        output: tempFrame,
        offsets: [1000],
        ffmpegPath: process.env.FFMPEG_PATH,
      });

      const smallThumbnail = await processImage(tempFrame);
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
          console.log("========== PROCESSED VIDEO ==========");
        } else if (mimeType.ext === "gif") {
          const dimensions = await getMediaDimensions(tempFile, "image");
          const web = await processGif(tempFile).catch((err) =>
            handleError(err)
          );
          console.log("========== PROCESSED GIF ==========");
          result = { ...dimensions, web };
        } else if (mimeType.contentType === "image") {
          const dimensions = await getMediaDimensions(tempFile, "image");
          const web = await processImage(tempFile).catch((err) =>
            handleError(err)
          );
          console.log("========== PROCESSED IMAGE ==========");
          result = { ...dimensions, web };
        }
      }

      resolve(result);
    } catch {
      reject({ err: 5, msg: "Issue processing file" });
    }
  }).catch((err) => handleError(err));
};

/* TODO
 * 1. CHANGE RUN SCRIPT TO USE DATABASE INSTEAD OF S3 SAMPLE IMAGES
 * 2. DOES NOT NEED TO BE ASYNC
 * 3. STORE ASSET FROM TEMP TO S3 / CDN
 * 4. DELETE ASSET FROM TEMP
 */
const runScript = async () => {
  s3Client.listObjectsV2(bucketParams, async (err: any, data: any) => {
    if (err) console.log(err, err.stack);
    else {
      let i = 0;
      while (i < data.Contents.length) {
        console.log("PROCESSING FILE: ", data.Contents[i].Key);
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
